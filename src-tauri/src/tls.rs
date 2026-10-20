// TLS for the RIDE connection bridge. Matches what Node's tls.connect did in the
// Electron shell: roots come from rootcertsdir (Mozilla's list otherwise), the
// hostname isn't checked against SANs, the subject CN must equal the host when
// `subj` is set, and a PEM client certificate is optional.

use std::fmt;
use std::io;
use std::sync::{Arc, OnceLock};

use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, Error, OtherError, RootCertStore,
    SignatureScheme,
};
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{
    AlgorithmIdentifier, CertificateDer, InvalidSignature, PrivateKeyDer, ServerName,
    SignatureVerificationAlgorithm, UnixTime, alg_id,
};
use serde::Deserialize;
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_rustls::client::TlsStream;

use crate::conn::{ConnError, io_error};

#[derive(Deserialize)]
pub struct TlsOpts {
    cert: Option<String>,
    key: Option<String>,
    rootcertsdir: Option<String>,
    #[serde(default)]
    subj: bool,
}

fn nonempty(s: &Option<String>) -> Option<&str> {
    s.as_deref().filter(|s| !s.is_empty())
}

// Dyalog's TestCertificates/ca/ca-cert.pem encodes its key as rsaEncryption without
// the NULL parameter and with a negative modulus, which webpki and ring reject but
// OpenSSL accepts. These algorithms verify chain signatures made by such keys.
#[derive(Debug)]
struct RsaNoNull {
    sig: AlgorithmIdentifier,
    alg: &'static ring::signature::RsaParameters,
}

static RSA_NO_NULL: [RsaNoNull; 3] = [
    RsaNoNull {
        sig: alg_id::RSA_PKCS1_SHA256,
        alg: &ring::signature::RSA_PKCS1_2048_8192_SHA256,
    },
    RsaNoNull {
        sig: alg_id::RSA_PKCS1_SHA384,
        alg: &ring::signature::RSA_PKCS1_2048_8192_SHA384,
    },
    RsaNoNull {
        sig: alg_id::RSA_PKCS1_SHA512,
        alg: &ring::signature::RSA_PKCS1_2048_8192_SHA512,
    },
];

impl SignatureVerificationAlgorithm for RsaNoNull {
    fn public_key_alg_id(&self) -> AlgorithmIdentifier {
        AlgorithmIdentifier::from_slice(&[
            0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
        ])
    }
    fn signature_alg_id(&self) -> AlgorithmIdentifier {
        self.sig
    }
    fn verify_signature(&self, pk: &[u8], msg: &[u8], sig: &[u8]) -> Result<(), InvalidSignature> {
        let (n, e) = parse_rsa_pub(pk).ok_or(InvalidSignature)?;
        ring::signature::RsaPublicKeyComponents { n, e }
            .verify(self.alg, msg, sig)
            .map_err(|_| InvalidSignature)
    }
}

fn der_tlv(b: &[u8], tag: u8) -> Option<(&[u8], &[u8])> {
    if *b.first()? != tag {
        return None;
    }
    let (len, hdr) = match *b.get(1)? {
        l if l < 0x80 => (l as usize, 2),
        0x81 => (*b.get(2)? as usize, 3),
        0x82 => (((*b.get(2)? as usize) << 8) | *b.get(3)? as usize, 4),
        _ => return None,
    };
    let v = b.get(hdr..hdr + len)?;
    Some((v, &b[hdr + len..]))
}

// RSAPublicKey ::= SEQUENCE { n INTEGER, e INTEGER }, read as unsigned magnitudes
fn parse_rsa_pub(pk: &[u8]) -> Option<(&[u8], &[u8])> {
    let (seq, _) = der_tlv(pk, 0x30)?;
    let (n, rest) = der_tlv(seq, 0x02)?;
    let (e, _) = der_tlv(rest, 0x02)?;
    let trim = |x: &[u8]| x.iter().take_while(|&&b| b == 0).count();
    Some((&n[trim(n)..], &e[trim(e)..]))
}

fn provider() -> Arc<CryptoProvider> {
    static P: OnceLock<Arc<CryptoProvider>> = OnceLock::new();
    P.get_or_init(|| {
        let mut p = rustls::crypto::ring::default_provider();
        let mut all = p.signature_verification_algorithms.all.to_vec();
        all.extend(
            RSA_NO_NULL
                .iter()
                .map(|a| a as &dyn SignatureVerificationAlgorithm),
        );
        p.signature_verification_algorithms.all = Box::leak(all.into_boxed_slice());
        Arc::new(p)
    })
    .clone()
}

#[derive(Debug)]
struct WrongCertName(String);

impl fmt::Display for WrongCertName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for WrongCertName {}

fn subject_cn(cert: &CertificateDer<'_>) -> Option<String> {
    let (_, c) = x509_parser::parse_x509_certificate(cert.as_ref()).ok()?;
    c.subject()
        .iter_common_name()
        .next()
        .and_then(|cn| cn.as_str().ok().map(str::to_owned))
}

fn valid_now(cert: &CertificateDer<'_>) -> bool {
    x509_parser::parse_x509_certificate(cert.as_ref()).is_ok_and(|(_, c)| c.validity().is_valid())
}

#[derive(Debug)]
struct RideVerifier {
    inner: Arc<WebPkiServerVerifier>,
    expect_cn: Option<String>,
    pinned: Vec<CertificateDer<'static>>, // every certificate read from rootcertsdir
}

impl ServerCertVerifier for RideVerifier {
    fn verify_server_cert(
        &self,
        ee: &CertificateDer<'_>,
        im: &[CertificateDer<'_>],
        sn: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        match self.inner.verify_server_cert(ee, im, sn, ocsp, now) {
            Ok(_) => {}
            // RIDE never checked SANs, only (optionally) the CN below
            Err(Error::InvalidCertificate(
                CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. },
            )) => {}
            // a self-signed server certificate placed in rootcertsdir, as Node accepted
            Err(_) if self.pinned.iter().any(|p| p.as_ref() == ee.as_ref()) && valid_now(ee) => {}
            Err(e) => return Err(e),
        }
        if let Some(want) = &self.expect_cn {
            let got = subject_cn(ee);
            if got.as_deref() != Some(want.as_str()) {
                let js = |s: &str| serde_json::to_string(s).unwrap_or_default();
                let got = got.as_deref().map_or_else(|| "undefined".into(), js);
                let msg = format!(
                    "Wrong server certificate name. Expected:{}, actual:{got}",
                    js(want)
                );
                return Err(Error::Other(OtherError(Arc::new(WrongCertName(msg)))));
            }
        }
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        m: &[u8],
        c: &CertificateDer<'_>,
        d: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.inner.verify_tls12_signature(m, c, d)
    }
    fn verify_tls13_signature(
        &self,
        m: &[u8],
        c: &CertificateDer<'_>,
        d: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.inner.verify_tls13_signature(m, c, d)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

fn file_error(e: &io::Error, p: &str) -> ConnError {
    let code = match e.kind() {
        io::ErrorKind::NotFound => "ENOENT",
        io::ErrorKind::PermissionDenied => "EACCES",
        _ => "EIO",
    };
    ConnError::new(code, format!("{code}: cannot read {p:?}: {e}"))
}

fn read(p: &str) -> Result<Vec<u8>, ConnError> {
    std::fs::read(p).map_err(|e| file_error(&e, p))
}

fn certs(pem: &[u8]) -> Vec<CertificateDer<'static>> {
    CertificateDer::pem_slice_iter(pem)
        .map_while(Result::ok)
        .collect()
}

// Reads the files first, as the Electron shell did, so a bad path fails before connecting.
pub fn config(host: &str, o: &TlsOpts) -> Result<Arc<ClientConfig>, ConnError> {
    let mut roots = RootCertStore::empty();
    let mut pinned = Vec::new();
    if let Some(d) = nonempty(&o.rootcertsdir) {
        // Like Node's `ca`, every file is read as PEM; files without certificates add nothing.
        for ent in std::fs::read_dir(d).map_err(|e| file_error(&e, d))? {
            let p = ent.map_err(|e| file_error(&e, d))?.path();
            if !p.is_file() {
                continue;
            }
            let Ok(b) = std::fs::read(&p) else { continue };
            for c in certs(&b) {
                pinned.push(c.clone());
                let _ = roots.add(c);
            }
        }
        if roots.is_empty() {
            return Err(ConnError::new(
                "EINVAL",
                format!("No PEM root certificates found in {d:?}"),
            ));
        }
    } else {
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    }
    let p = provider();
    let inner = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), p.clone())
        .build()
        .map_err(|e| ConnError::new("EINVAL", format!("TLS setup failed: {e}")))?;
    let verifier = RideVerifier {
        inner,
        expect_cn: o.subj.then(|| host.to_owned()),
        pinned,
    };
    let b = ClientConfig::builder_with_provider(p)
        .with_protocol_versions(rustls::ALL_VERSIONS)
        .map_err(|e| ConnError::new("EINVAL", format!("TLS setup failed: {e}")))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier));
    let cfg = match nonempty(&o.cert) {
        None => b.with_no_client_auth(),
        Some(c) => {
            let k = o.key.as_deref().unwrap_or_default();
            let chain = certs(&read(c)?);
            if chain.is_empty() {
                return Err(ConnError::new(
                    "EINVAL",
                    format!("No PEM certificate found in {c:?}"),
                ));
            }
            let key = PrivateKeyDer::from_pem_slice(&read(k)?).map_err(|_| {
                ConnError::new("EINVAL", format!("No PEM private key found in {k:?}"))
            })?;
            b.with_client_auth_cert(chain, key).map_err(|e| {
                ConnError::new("EINVAL", format!("Cannot use the client certificate: {e}"))
            })?
        }
    };
    Ok(Arc::new(cfg))
}

pub async fn handshake(
    cfg: Arc<ClientConfig>,
    host: &str,
    tcp: TcpStream,
) -> Result<TlsStream<TcpStream>, ConnError> {
    // SNI is only sent for DNS names; anything else is named by the peer's address.
    let sn = match ServerName::try_from(host.to_owned()) {
        Ok(s) => s,
        Err(_) => ServerName::IpAddress(
            tcp.peer_addr()
                .map_err(|e| io_error(&e, "connect"))?
                .ip()
                .into(),
        ),
    };
    TlsConnector::from(cfg).connect(sn, tcp).await.map_err(|e| {
        use io::ErrorKind::*;
        // A plain (non-TLS) interpreter either resets or answers with a Ride frame;
        // cn.js would hide the reset, so both get a hint.
        let garbled = e
            .get_ref()
            .and_then(|x| x.downcast_ref::<Error>())
            .is_some_and(|x| matches!(x, Error::InvalidMessage(_)));
        if garbled
            || matches!(
                e.kind(),
                ConnectionReset | ConnectionAborted | UnexpectedEof
            )
        {
            ConnError::new(
                "EPROTO",
                "TLS handshake failed. Check that the interpreter serves Ride over TLS.",
            )
        } else {
            tls_error(&e, "TLS handshake failed")
        }
    })
}

// rustls errors arrive wrapped in io::Error; a wrong CN becomes ECERTNAME, as in the Electron shell.
pub fn tls_error(e: &io::Error, what: &str) -> ConnError {
    match e.get_ref().and_then(|x| x.downcast_ref::<Error>()) {
        Some(Error::Other(OtherError(x))) if x.is::<WrongCertName>() => {
            ConnError::new("ECERTNAME", x.to_string())
        }
        Some(r) => ConnError::new("EPROTO", format!("{what}: {r}")),
        None => io_error(e, what),
    }
}
