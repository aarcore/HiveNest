module github.com/hivenest/hivenest/worker

go 1.26.0

require (
	github.com/google/uuid v1.6.0
	github.com/gorilla/websocket v1.5.3
	github.com/hivenest/hivenest/protocol v0.0.0
)

require golang.org/x/sys v0.49.0

replace github.com/hivenest/hivenest/protocol => ../protocol
