package tools

import (
	"encoding/base64"
	"fmt"
	"os"
	"path"
	"strings"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

func runWriteFile(client *ssh.Client, exec ExecFunc, rawPath, content string) (*Result, error) {
	p, err := SafePath(rawPath)
	if err != nil {
		return nil, err
	}
	if len(content) > MaxWriteBytes {
		return nil, fmt.Errorf("content too long (max %d bytes)", MaxWriteBytes)
	}
	remote := expandHomeHint(p)
	if sc, err := openSFTP(client); err == nil {
		defer sc.Close()
		if err := sftpWriteFile(sc, remote, content); err == nil {
			return &Result{
				Summary: fmt.Sprintf("wrote %d bytes to %s", len(content), p),
				Via:     "sftp",
				Data: map[string]any{
					"path":  p,
					"bytes": len(content),
				},
			}, nil
		}
	}
	if exec == nil {
		return nil, fmt.Errorf("write_file: sftp unavailable and no exec runner")
	}
	cmd := writeFileExecCmd(p, content)
	stdout, stderr, code, err := exec(cmd)
	if err != nil {
		return &Result{Via: "exec", Summary: stderr, Error: err.Error()}, err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		return &Result{Via: "exec", Summary: msg, Error: fmt.Sprintf("exit %d", code)}, fmt.Errorf("write_file exit %d", code)
	}
	return &Result{
		Summary: fmt.Sprintf("wrote %d bytes to %s", len(content), p),
		Via:     "exec",
		Data:    map[string]any{"path": p, "bytes": len(content)},
	}, nil
}

func sftpWriteFile(sc *sftp.Client, remote, content string) error {
	dir := path.Dir(remote)
	if dir != "" && dir != "." && dir != "/" {
		_ = sc.MkdirAll(dir)
	}
	f, err := sc.OpenFile(remote, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write([]byte(content))
	return err
}

func writeFileExecCmd(p, content string) string {
	b64 := base64.StdEncoding.EncodeToString([]byte(content))
	return fmt.Sprintf("printf '%%s' %s | base64 -d > %s", shellSingleQuote(b64), shellSingleQuote(p))
}

func runMkdir(client *ssh.Client, exec ExecFunc, rawPath string) (*Result, error) {
	p, err := SafePath(rawPath)
	if err != nil {
		return nil, err
	}
	remote := expandHomeHint(p)
	if sc, err := openSFTP(client); err == nil {
		defer sc.Close()
		if err := sc.MkdirAll(remote); err == nil {
			return &Result{
				Summary: fmt.Sprintf("mkdir %s", p),
				Via:     "sftp",
				Data:    map[string]any{"path": p},
			}, nil
		}
	}
	if exec == nil {
		return nil, fmt.Errorf("mkdir: sftp unavailable and no exec runner")
	}
	cmd := fmt.Sprintf("mkdir -p -- %s", shellSingleQuote(p))
	stdout, stderr, code, err := exec(cmd)
	if err != nil {
		return &Result{Via: "exec", Summary: stderr, Error: err.Error()}, err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		return &Result{Via: "exec", Summary: msg, Error: fmt.Sprintf("exit %d", code)}, fmt.Errorf("mkdir exit %d", code)
	}
	return &Result{
		Summary: fmt.Sprintf("mkdir %s", p),
		Via:     "exec",
		Data:    map[string]any{"path": p},
	}, nil
}

func runRemoveFile(client *ssh.Client, exec ExecFunc, rawPath string) (*Result, error) {
	p, err := SafePath(rawPath)
	if err != nil {
		return nil, err
	}
	remote := expandHomeHint(p)
	if sc, err := openSFTP(client); err == nil {
		defer sc.Close()
		if err := sc.Remove(remote); err == nil {
			return &Result{
				Summary: fmt.Sprintf("removed file %s", p),
				Via:     "sftp",
				Data:    map[string]any{"path": p},
			}, nil
		}
	}
	if exec == nil {
		return nil, fmt.Errorf("remove_file: sftp unavailable and no exec runner")
	}
	cmd := fmt.Sprintf("rm -- %s", shellSingleQuote(p))
	stdout, stderr, code, err := exec(cmd)
	if err != nil {
		return &Result{Via: "exec", Summary: stderr, Error: err.Error()}, err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		return &Result{Via: "exec", Summary: msg, Error: fmt.Sprintf("exit %d", code)}, fmt.Errorf("remove_file exit %d", code)
	}
	return &Result{
		Summary: fmt.Sprintf("removed file %s", p),
		Via:     "exec",
		Data:    map[string]any{"path": p},
	}, nil
}

func runRemoveDir(client *ssh.Client, exec ExecFunc, rawPath string) (*Result, error) {
	p, err := SafePath(rawPath)
	if err != nil {
		return nil, err
	}
	// Refuse filesystem roots.
	if p == "/" || p == "~" {
		return nil, fmt.Errorf("refusing to remove root path")
	}
	remote := expandHomeHint(p)
	if sc, err := openSFTP(client); err == nil {
		defer sc.Close()
		if err := sc.RemoveDirectory(remote); err == nil {
			return &Result{
				Summary: fmt.Sprintf("removed directory %s", p),
				Via:     "sftp",
				Data:    map[string]any{"path": p},
			}, nil
		}
	}
	if exec == nil {
		return nil, fmt.Errorf("rmdir: sftp unavailable and no exec runner")
	}
	cmd := fmt.Sprintf("rmdir -- %s", shellSingleQuote(p))
	stdout, stderr, code, err := exec(cmd)
	if err != nil {
		return &Result{Via: "exec", Summary: stderr, Error: err.Error()}, err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		return &Result{Via: "exec", Summary: msg, Error: fmt.Sprintf("exit %d", code)}, fmt.Errorf("rmdir exit %d", code)
	}
	return &Result{
		Summary: fmt.Sprintf("removed directory %s", p),
		Via:     "exec",
		Data:    map[string]any{"path": p},
	}, nil
}
