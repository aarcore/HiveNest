.PHONY: all build queen worker sessiond tidy test clean docker-up docker-down run release-worker release-sessiond client-dev client-build

VERSION ?= 0.5.0-dev

LDFLAGS := -X main.version=$(VERSION)

all: queen worker sessiond
build: all

queen:
	cd queen && go build -ldflags "$(LDFLAGS)" -o ../bin/queen ./cmd/queen

worker:
	cd worker && go build -ldflags "$(LDFLAGS)" -o ../bin/worker ./cmd/worker

sessiond:
	cd sessiond && go build -ldflags "$(LDFLAGS)" -o ../bin/sessiond ./cmd/sessiond

# Cross-compile Worker for real Linux hosts (no CGO).
release-worker:
	mkdir -p dist
	cd worker && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS) -s -w" -o ../dist/hivenest-worker-linux-amd64 ./cmd/worker
	cd worker && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS) -s -w" -o ../dist/hivenest-worker-linux-arm64 ./cmd/worker
	@ls -lh dist/hivenest-worker-linux-*
	@echo "Artifacts ready under dist/. Serve via Queen HIVENEST_ARTIFACT_DIR=./dist"

tidy:
	cd protocol && go mod tidy
	cd queen && go mod tidy
	cd worker && go mod tidy
	cd sessiond && go mod tidy

test:
	cd protocol && go test ./...
	cd queen && go test ./...
	cd worker && go test ./...
	cd sessiond && go test ./...

clean:
	rm -rf bin dist

run: all
	@echo "Start: ./bin/queen   then   ./bin/worker"
	@echo "UI: http://127.0.0.1:8080/"

# docker-up rebuilds legacy web/ for Queen image embed; sessiond/client do not need it.
docker-up: web
	docker compose -f deploy/docker-compose.yml up --build

docker-down:
	docker compose -f deploy/docker-compose.yml down

.PHONY: web
# LEGACY: builds Queen-embedded SPA from web/ (not client/). Prefer `make client-dev` for Hive Nest UI.
web:
	cd web && npm install && npm run build

.PHONY: queen-with-ui
queen-with-ui: web
	$(MAKE) queen

# Cross-compile sessiond for client platforms (no CGO).
release-sessiond:
	mkdir -p dist
	cd sessiond && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS) -s -w" -o ../dist/hivenest-sessiond-darwin-arm64 ./cmd/sessiond
	cd sessiond && CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS) -s -w" -o ../dist/hivenest-sessiond-darwin-amd64 ./cmd/sessiond
	cd sessiond && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS) -s -w" -o ../dist/hivenest-sessiond-linux-amd64 ./cmd/sessiond
	cd sessiond && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS) -s -w" -o ../dist/hivenest-sessiond-linux-arm64 ./cmd/sessiond
	cd sessiond && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS) -s -w" -o ../dist/hivenest-sessiond-windows-amd64.exe ./cmd/sessiond
	@ls -lh dist/hivenest-sessiond-*

.PHONY: client-dev client-build tauri-dev tauri-build tauri-build-unsigned prepare-sidecars package-docs help-desktop make-dmg desktop-ci-docs
client-dev:
	cd client && npm install && npm run dev

client-build:
	cd client && npm install && npm run build

tauri-dev:
	cd client && npm install && npm run tauri:dev

# Tauri externalBin names:
#   sessiond-aarch64-apple-darwin
#   sessiond-x86_64-apple-darwin
#   sessiond-x86_64-unknown-linux-gnu
#   sessiond-aarch64-unknown-linux-gnu
#   sessiond-x86_64-pc-windows-msvc.exe
prepare-sidecars:
	mkdir -p client/src-tauri/binaries dist
	cd sessiond && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS) -s -w" -o ../client/src-tauri/binaries/sessiond-aarch64-apple-darwin ./cmd/sessiond
	cd sessiond && CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS) -s -w" -o ../client/src-tauri/binaries/sessiond-x86_64-apple-darwin ./cmd/sessiond
	cd sessiond && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS) -s -w" -o ../client/src-tauri/binaries/sessiond-x86_64-unknown-linux-gnu ./cmd/sessiond
	cd sessiond && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS) -s -w" -o ../client/src-tauri/binaries/sessiond-aarch64-unknown-linux-gnu ./cmd/sessiond
	cd sessiond && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS) -s -w" -o ../client/src-tauri/binaries/sessiond-x86_64-pc-windows-msvc.exe ./cmd/sessiond
	@ls -lh client/src-tauri/binaries/sessiond-*
	@echo "Tauri externalBin expects: binaries/sessiond (+ target triple suffix)"

# Unsigned desktop bundle for this host. Notarization / Authenticode are manual.
tauri-build tauri-build-unsigned:
	$(MAKE) prepare-sidecars
	$(MAKE) sessiond
	@triple=$$(rustc -vV | awk '/host:/ {print $$2}'); \
	  cp bin/sessiond client/src-tauri/binaries/sessiond-$$triple; \
	  echo "sidecar -> client/src-tauri/binaries/sessiond-$$triple"
	cd client && npm install && npm run tauri:build
	@echo "Unsigned bundle under client/src-tauri/target/release/bundle/"
	@echo "Notarization / Authenticode are manual — see docs/11-desktop-packaging.md"

package-docs:
	@echo "See docs/11-desktop-packaging.md"

# Unsigned DMG via hdiutil (no Finder Automation / Apple Events).
make-dmg:
	bash scripts/make-dmg.sh

help-desktop:
	@echo "Desktop targets:"
	@echo "  make client-dev          - Vite UI on :5173"
	@echo "  make tauri-dev           - Tauri + Vite"
	@echo "  make prepare-sidecars    - sessiond for all OS triples (win/linux/darwin)"
	@echo "  make tauri-build         - unsigned desktop bundle (this host)"
	@echo "  make make-dmg            - hdiutil DMG from .app (no Finder)"
	@echo "  CI: .github/workflows/desktop.yml (linux/windows/macos unsigned)"
	@echo "  docs: docs/11-desktop-packaging.md"

# Document-only reminder: full Linux/Windows bundles need those OS runners (see CI).
desktop-ci-docs:
	@echo "See docs/11-desktop-packaging.md and .github/workflows/desktop.yml"
