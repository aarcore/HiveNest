package risk

import "testing"

func TestClassify(t *testing.T) {
	cases := []struct {
		cmd  string
		want Level
	}{
		{"uname -a", Low},
		{"df -h", Low},
		{"sudo systemctl restart nginx", High},
		{"rm -rf /var/tmp/x", High},
		{"chmod 644 file", Medium},
	}
	for _, c := range cases {
		if got := Classify(c.cmd); got != c.want {
			t.Fatalf("%q: got %s want %s", c.cmd, got, c.want)
		}
	}
}

func TestClassifyTool(t *testing.T) {
	if ClassifyTool("write_file") != Medium || ClassifyTool("mkdir") != Medium {
		t.Fatal("write/mkdir")
	}
	if ClassifyTool("remove_file") != High || ClassifyTool("rmdir") != High {
		t.Fatal("remove")
	}
	if ClassifyTool("list_files") != Low {
		t.Fatal("list")
	}
}
