package tools_test

import (
	"strings"
	"testing"

	"github.com/hivenest/hivenest/sessiond/internal/tools"
)

func TestSafePath(t *testing.T) {
	ok, err := tools.SafePath("/var/log")
	if err != nil || ok != "/var/log" {
		t.Fatalf("got %q %v", ok, err)
	}
	if _, err := tools.SafePath("../etc/passwd"); err == nil {
		t.Fatal("expected rejection for ..")
	}
	if _, err := tools.SafePath("/tmp/$(id)"); err == nil {
		t.Fatal("expected rejection for $(")
	}
	if _, err := tools.SafePath("relative"); err == nil {
		t.Fatal("expected rejection for relative")
	}
	if p, err := tools.SafePath("~/notes.txt"); err != nil || p != "~/notes.txt" {
		t.Fatalf("home path: %q %v", p, err)
	}
}

func TestSafeProcessPattern(t *testing.T) {
	if _, err := tools.SafeProcessPattern("nginx"); err != nil {
		t.Fatal(err)
	}
	if _, err := tools.SafeProcessPattern("bad;rm"); err == nil {
		t.Fatal("expected reject")
	}
}

func TestSafeUser(t *testing.T) {
	if _, err := tools.SafeUser("www-data"); err != nil {
		t.Fatal(err)
	}
	if _, err := tools.SafeUser("bad;user"); err == nil {
		t.Fatal("expected reject")
	}
}

func TestDisplayCommand(t *testing.T) {
	cmd, err := tools.DisplayCommand(tools.Request{Tool: tools.ListFiles, Path: "/tmp"})
	if err != nil || !strings.Contains(cmd, "ls -la") {
		t.Fatalf("%q %v", cmd, err)
	}
	cmd, err = tools.DisplayCommand(tools.Request{Tool: tools.DiskFree})
	if err != nil || cmd != "df -h" {
		t.Fatalf("%q %v", cmd, err)
	}
	cmd, err = tools.DisplayCommand(tools.Request{Tool: tools.WriteFile, Path: "/tmp/x", Content: "hi"})
	if err != nil || !strings.Contains(cmd, "base64") || !strings.Contains(cmd, "/tmp/x") {
		t.Fatalf("%q %v", cmd, err)
	}
	cmd, err = tools.DisplayCommand(tools.Request{Tool: tools.RemoveFile, Path: "/tmp/x"})
	if err != nil || !strings.HasPrefix(cmd, "rm --") {
		t.Fatalf("%q %v", cmd, err)
	}
}

func TestToolRisk(t *testing.T) {
	if tools.ToolRisk(tools.ListFiles) != "low" {
		t.Fatal("list low")
	}
	if tools.ToolRisk(tools.WriteFile) != "medium" || tools.ToolRisk(tools.Mkdir) != "medium" {
		t.Fatal("write medium")
	}
	if tools.ToolRisk(tools.RemoveFile) != "high" || tools.ToolRisk(tools.RemoveDir) != "high" {
		t.Fatal("remove high")
	}
}

func TestRunDiskFreeViaExec(t *testing.T) {
	sample := "Filesystem     Size  Used Avail Use% Mounted on\n/dev/sda1       20G   10G   9.0G  53% /\n"
	exec := func(cmd string) (string, string, int, error) {
		if !strings.HasPrefix(cmd, "df") {
			t.Fatalf("unexpected cmd %q", cmd)
		}
		return sample, "", 0, nil
	}
	res, err := tools.Run(nil, tools.Request{Tool: tools.DiskFree}, exec)
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK || res.Via != "exec" {
		t.Fatalf("%#v", res)
	}
	rows, ok := res.Data["rows"].([]map[string]string)
	if !ok || len(rows) != 1 || rows[0]["mounted"] != "/" {
		t.Fatalf("rows %#v", res.Data["rows"])
	}
}

func TestRunListProcessesFilter(t *testing.T) {
	sample := strings.Join([]string{
		"USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND",
		"root 1 0.0 0.1 0 0 ? Ss Jan01 0:00 /sbin/init",
		"www 42 0.0 0.1 0 0 ? S Jan01 0:00 nginx: master",
		"www 43 0.0 0.1 0 0 ? S Jan01 0:00 nginx: worker",
		"aaron 99 0.0 0.1 0 0 ? S Jan01 0:00 vim",
	}, "\n") + "\n"
	exec := func(cmd string) (string, string, int, error) {
		return sample, "", 0, nil
	}
	res, err := tools.Run(nil, tools.Request{Tool: tools.ListProcesses, Pattern: "nope"}, exec)
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK || !strings.Contains(res.Summary, "no matching") {
		t.Fatalf("%#v", res)
	}
	res, err = tools.Run(nil, tools.Request{Tool: tools.ListProcesses, Pattern: "nginx", User: "www", Limit: 1}, exec)
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK || res.Data["count"].(int) != 1 || !res.Data["truncated"].(bool) {
		t.Fatalf("%#v", res.Data)
	}
}

func TestRunWriteFileRequiresClient(t *testing.T) {
	exec := func(cmd string) (string, string, int, error) { return "", "", 0, nil }
	_, err := tools.Run(nil, tools.Request{Tool: tools.WriteFile, Path: "/tmp/x", Content: "hi"}, exec)
	if err == nil {
		t.Fatal("expected error for nil client")
	}
}
