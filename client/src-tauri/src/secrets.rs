//! OS keychain helpers for SSH passwords. Never log secret values.

use keyring::Entry;

const SERVICE: &str = "HiveNest";

fn entry(account: &str) -> Result<Entry, String> {
    let account = account.trim();
    if account.is_empty() || account.len() > 256 {
        return Err("invalid secret account".into());
    }
    // Reject control chars
    if account.chars().any(|c| c.is_control()) {
        return Err("invalid secret account".into());
    }
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_set(account: String, secret: String) -> Result<(), String> {
    if secret.is_empty() {
        return secret_delete(account);
    }
    let e = entry(&account)?;
    e.set_password(&secret).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(account: String) -> Result<Option<String>, String> {
    let e = entry(&account)?;
    match e.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    let e = entry(&account)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}
