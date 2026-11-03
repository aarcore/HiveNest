// Package risk classifies shell commands for the approve-before-exec gate.
package risk

import (
	"regexp"
	"strings"
)

type Level string

const (
	Low    Level = "low"
	Medium Level = "medium"
	High   Level = "high"
)

var (
	highPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\brm\s+(-[a-zA-Z]*f|/|~|/etc|/var|/usr|/home)`),
		regexp.MustCompile(`(?i)\brm\s+-rf\b`),
		regexp.MustCompile(`(?i)\bmkfs\b`),
		regexp.MustCompile(`(?i)\bdd\s+if=`),
		regexp.MustCompile(`(?i)\b(shutdown|reboot|poweroff|halt)\b`),
		regexp.MustCompile(`(?i)\buser(add|del|mod)\b`),
		regexp.MustCompile(`(?i)\bpasswd\b`),
		regexp.MustCompile(`(?i)\b(iptables|nft|ufw|firewall-cmd)\b`),
		regexp.MustCompile(`(?i)\bsystemctl\s+(stop|disable|mask|restart)\b`),
		regexp.MustCompile(`(?i)\b(apt|yum|dnf|pacman|zypper)\s+(install|remove|erase)\b`),
		regexp.MustCompile(`(?i)\bchmod\s+[0-7]*777\b`),
		regexp.MustCompile(`(?i)\bchown\s+-R\b`),
		regexp.MustCompile(`(?i)\bcurl\b.*\|\s*(ba)?sh\b`),
		regexp.MustCompile(`(?i)\bwget\b.*\|\s*(ba)?sh\b`),
		regexp.MustCompile(`(?i)\b>\s*/etc/`),
		regexp.MustCompile(`(?i)\btee\s+/etc/`),
	}
	mediumPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\bsudo\b`),
		regexp.MustCompile(`(?i)\bsystemctl\s+(start|enable|reload)\b`),
		regexp.MustCompile(`(?i)\b(apt|yum|dnf)\s+update\b`),
		regexp.MustCompile(`(?i)\bchmod\b`),
		regexp.MustCompile(`(?i)\bchown\b`),
		regexp.MustCompile(`(?i)\bkill\b`),
		regexp.MustCompile(`(?i)\bpkill\b`),
		regexp.MustCompile(`(?i)\bmv\s+`),
		regexp.MustCompile(`(?i)\bcp\s+-`),
	}
)

// Classify returns a risk level for a full command string.
func Classify(cmd string) Level {
	c := strings.TrimSpace(cmd)
	if c == "" {
		return Low
	}
	for _, re := range highPatterns {
		if re.MatchString(c) {
			return High
		}
	}
	for _, re := range mediumPatterns {
		if re.MatchString(c) {
			return Medium
		}
	}
	return Low
}

// NeedsApproval reports whether exec must present an approved proposal.
// MVP: medium and high require approval; low may run directly (still audited).
func NeedsApproval(level Level) bool {
	return level == Medium || level == High
}

// ClassifyTool returns risk for a structured Agent tool name.
func ClassifyTool(tool string) Level {
	switch strings.TrimSpace(strings.ToLower(tool)) {
	case "write_file", "mkdir":
		return Medium
	case "remove_file", "rmdir":
		return High
	default:
		return Low
	}
}
