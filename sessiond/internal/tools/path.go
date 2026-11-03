// Package tools implements structured remote ops for Agent (SFTP + controlled exec).
package tools

import (
	"fmt"
	"path"
	"strings"
	"unicode"
)

// MaxReadBytes caps read_file payloads returned to the Agent.
const MaxReadBytes = 65536

// MaxWriteBytes caps write_file payloads.
const MaxWriteBytes = 65536

// DefaultProcessLimit / MaxProcessLimit bound list_processes output.
const DefaultProcessLimit = 100
const MaxProcessLimit = 500

// SafePath rejects shell metacharacters and path traversal. Allows absolute paths
// and simple home-relative paths starting with "~/".
func SafePath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", fmt.Errorf("path is required")
	}
	if len(p) > 512 {
		return "", fmt.Errorf("path too long")
	}
	for _, r := range p {
		if r < 0x20 || r == 0x7f {
			return "", fmt.Errorf("path contains control characters")
		}
	}
	if strings.ContainsAny(p, "`$;&|<>(){}!\n\r\t\"'\\") {
		return "", fmt.Errorf("path contains disallowed characters")
	}
	if strings.Contains(p, "..") {
		return "", fmt.Errorf("path must not contain '..'")
	}
	if strings.HasPrefix(p, "~/") || p == "~" {
		return p, nil
	}
	if !strings.HasPrefix(p, "/") {
		return "", fmt.Errorf("path must be absolute or ~/…")
	}
	cleaned := path.Clean(p)
	if cleaned != p && cleaned+"/" != p {
		// Allow trailing slash differences only
		if strings.TrimSuffix(cleaned, "/") != strings.TrimSuffix(p, "/") {
			// still accept cleaned form
			p = cleaned
		}
	}
	return p, nil
}

// SafeProcessPattern allows a narrow filter for list_processes.
func SafeProcessPattern(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", nil
	}
	if len(s) > 64 {
		return "", fmt.Errorf("pattern too long")
	}
	for _, r := range s {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune("._:@+/-", r)) {
			return "", fmt.Errorf("pattern contains disallowed characters")
		}
	}
	return s, nil
}

// SafeUser allows a narrow username filter for list_processes.
func SafeUser(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", nil
	}
	if len(s) > 32 {
		return "", fmt.Errorf("user too long")
	}
	for _, r := range s {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' || r == '.') {
			return "", fmt.Errorf("user contains disallowed characters")
		}
	}
	return s, nil
}

func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}
