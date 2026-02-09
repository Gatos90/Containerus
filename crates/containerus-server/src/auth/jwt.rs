use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const JWT_ISSUER: &str = "containerus";
const JWT_AUDIENCE: &str = "containerus-client";

/// A user's membership in a project (embedded in JWT).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectMembership {
    pub project_id: Uuid,
    pub role_id: Uuid,
}

/// JWT claims for access tokens.
#[derive(Serialize, Deserialize, Clone)]
pub struct AccessClaims {
    /// Subject: user ID
    pub sub: Uuid,
    /// Issuer
    pub iss: String,
    /// Audience
    pub aud: String,
    /// User's email
    pub email: String,
    /// All project memberships for this user
    pub memberships: Vec<ProjectMembership>,
    /// Whether this user is a company admin (super-admin)
    pub is_company_admin: bool,
    /// Issued at
    pub iat: i64,
    /// Expiration
    pub exp: i64,
}

impl AccessClaims {
    /// Find the user's role_id for a specific project.
    pub fn role_for_project(&self, project_id: &Uuid) -> Option<Uuid> {
        self.memberships
            .iter()
            .find(|m| &m.project_id == project_id)
            .map(|m| m.role_id)
    }
}

impl std::fmt::Debug for AccessClaims {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccessClaims")
            .field("sub", &self.sub)
            .field("email", &"[redacted]")
            .field("memberships", &self.memberships.len())
            .field("is_company_admin", &self.is_company_admin)
            .field("iat", &self.iat)
            .field("exp", &self.exp)
            .finish()
    }
}

/// JWT claims for refresh tokens (minimal payload).
#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshClaims {
    /// Subject: user ID
    pub sub: Uuid,
    /// Issuer
    pub iss: String,
    /// Audience
    pub aud: String,
    /// Token family ID for rotation detection
    pub jti: Uuid,
    pub iat: i64,
    pub exp: i64,
}

/// Create an access token.
pub fn create_access_token(
    user_id: Uuid,
    email: &str,
    memberships: Vec<ProjectMembership>,
    is_company_admin: bool,
    secret: &str,
    expiry_secs: i64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let claims = AccessClaims {
        sub: user_id,
        iss: JWT_ISSUER.to_string(),
        aud: JWT_AUDIENCE.to_string(),
        email: email.to_string(),
        memberships,
        is_company_admin,
        iat: now.timestamp(),
        exp: (now + Duration::seconds(expiry_secs)).timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

/// Create a refresh token (returns token string + token ID for storage).
pub fn create_refresh_token(
    user_id: Uuid,
    secret: &str,
    expiry_secs: i64,
) -> Result<(String, Uuid), jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let jti = Uuid::new_v4();
    let claims = RefreshClaims {
        sub: user_id,
        iss: JWT_ISSUER.to_string(),
        aud: JWT_AUDIENCE.to_string(),
        jti,
        iat: now.timestamp(),
        exp: (now + Duration::seconds(expiry_secs)).timestamp(),
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;

    Ok((token, jti))
}

/// Decode and validate an access token.
pub fn decode_access_token(
    token: &str,
    secret: &str,
) -> Result<AccessClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.set_issuer(&[JWT_ISSUER]);
    validation.set_audience(&[JWT_AUDIENCE]);
    let data = decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

/// Decode and validate a refresh token.
pub fn decode_refresh_token(
    token: &str,
    secret: &str,
) -> Result<RefreshClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.set_issuer(&[JWT_ISSUER]);
    validation.set_audience(&[JWT_AUDIENCE]);
    let data = decode::<RefreshClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SECRET: &str = "test-secret-key-for-jwt-signing";

    #[test]
    fn test_access_token_roundtrip() {
        let user_id = Uuid::new_v4();
        let project_id = Uuid::new_v4();
        let role_id = Uuid::new_v4();
        let memberships = vec![ProjectMembership { project_id, role_id }];
        let token = create_access_token(
            user_id,
            "test@example.com",
            memberships,
            false,
            TEST_SECRET,
            3600,
        )
        .unwrap();

        let claims = decode_access_token(&token, TEST_SECRET).unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.email, "test@example.com");
        assert_eq!(claims.memberships.len(), 1);
        assert_eq!(claims.memberships[0].project_id, project_id);
        assert_eq!(claims.memberships[0].role_id, role_id);
        assert!(!claims.is_company_admin);
    }

    #[test]
    fn test_access_token_company_admin() {
        let user_id = Uuid::new_v4();
        let token = create_access_token(
            user_id,
            "admin@example.com",
            vec![],
            true,
            TEST_SECRET,
            3600,
        )
        .unwrap();

        let claims = decode_access_token(&token, TEST_SECRET).unwrap();
        assert_eq!(claims.sub, user_id);
        assert!(claims.is_company_admin);
        assert!(claims.memberships.is_empty());
    }

    #[test]
    fn test_refresh_token_roundtrip() {
        let user_id = Uuid::new_v4();
        let (token, jti) =
            create_refresh_token(user_id, TEST_SECRET, 604800).unwrap();

        let claims = decode_refresh_token(&token, TEST_SECRET).unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.jti, jti);
    }

    #[test]
    fn test_expired_token_rejected() {
        let user_id = Uuid::new_v4();
        let token = create_access_token(
            user_id,
            "test@example.com",
            vec![],
            false,
            TEST_SECRET,
            -120, // Already expired (beyond jsonwebtoken's 60s leeway)
        )
        .unwrap();

        assert!(decode_access_token(&token, TEST_SECRET).is_err());
    }

    #[test]
    fn test_wrong_secret_rejected() {
        let user_id = Uuid::new_v4();
        let token = create_access_token(
            user_id,
            "test@example.com",
            vec![],
            false,
            TEST_SECRET,
            3600,
        )
        .unwrap();

        assert!(decode_access_token(&token, "wrong-secret").is_err());
    }
}
