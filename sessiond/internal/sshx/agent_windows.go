//go:build windows

package sshx

import (
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/davidmz/go-pageant"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

const openSSHAgentPipe = `\\.\pipe\openssh-ssh-agent`

// agentAuth tries, in order:
//  1. SSH_AUTH_SOCK (unix socket path when set by OpenSSH / third-party agents)
//  2. Windows OpenSSH Authentication Agent named pipe
//  3. PuTTY Pageant (best-effort via go-pageant)
//
// Notes for operators:
//   - Prefer the built-in "OpenSSH Authentication Agent" Windows service.
//   - Pageant works when PuTTY Pageant is running; alternatively bridge Pageant
//     into OpenSSH or set identity_file on the host profile.
func agentAuth() (ssh.AuthMethod, error) {
	var errs []string

	if sock := strings.TrimSpace(os.Getenv("SSH_AUTH_SOCK")); sock != "" {
		if a, err := dialUnixAgent(sock); err == nil {
			return a, nil
		} else {
			errs = append(errs, "SSH_AUTH_SOCK: "+err.Error())
		}
	}

	if a, err := dialNamedPipeAgent(openSSHAgentPipe); err == nil {
		return a, nil
	} else {
		errs = append(errs, "openssh-ssh-agent: "+err.Error())
	}

	if a, err := pageantAuth(); err == nil {
		return a, nil
	} else {
		errs = append(errs, "pageant: "+err.Error())
	}

	return nil, fmt.Errorf("no Windows SSH agent available (%s); set identity_file or start OpenSSH Agent / Pageant", strings.Join(errs, "; "))
}

func dialUnixAgent(sock string) (ssh.AuthMethod, error) {
	conn, err := net.DialTimeout("unix", sock, 2*time.Second)
	if err != nil {
		return nil, err
	}
	return ssh.PublicKeysCallback(agent.NewClient(conn).Signers), nil
}

func dialNamedPipeAgent(pipe string) (ssh.AuthMethod, error) {
	conn, err := winio.DialPipe(pipe, nil)
	if err != nil {
		return nil, err
	}
	return ssh.PublicKeysCallback(agent.NewClient(conn).Signers), nil
}

func pageantAuth() (ssh.AuthMethod, error) {
	if !pageant.Available() {
		return nil, fmt.Errorf("Pageant window not found")
	}
	// go-pageant implements agent.Agent directly.
	a := pageant.New()
	return ssh.PublicKeysCallback(a.Signers), nil
}
