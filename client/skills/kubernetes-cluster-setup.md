---
id: kubernetes-cluster-setup
name: Kubernetes cluster setup
description: Guided kubeadm/k3s-style cluster build-out on the current Linux host via Approve.
---
# Skill: Kubernetes cluster setup

Use when the user asks to build, bootstrap, or join a Kubernetes cluster on the **current SSH session host**.

## Rules
1. Stay on this host only; never pivot to other machines unless the user names them and opens that session.
2. Every install/join/write goes through visible Command Proposals → **Approve**. Never silently mutate.
3. Detect OS first (`cat /etc/os-release`, `uname -m`). Prefer the user's chosen distro path (kubeadm, k3s, or microk8s) — ask once if unspecified.
4. Prefer idempotent checks before install: `command -v kubectl`, `systemctl is-active containerd|crio|docker`, existing `/etc/kubernetes`.
5. Do not disable swap, open firewall ports, or rewrite sysctl until the user confirms the plan.
6. Never download unsigned install scripts into a pipe without stating the URL and getting Approve for the exact command.

## Suggested flow
1. Inventory: OS, CPU/RAM/disk, swap, kernel modules (`br_netfilter`), cgroup v2.
2. Propose a short plan (single-node vs control-plane+worker; CNI choice).
3. Install runtime + kube tools with package manager when possible.
4. `kubeadm init` / `k3s` install / equivalent — one Approve step at a time.
5. Show kubeconfig location and a smoke test (`kubectl get nodes`) after Approve.
6. Stop with a clear summary; do not auto-install addons (Ingress, cert-manager) unless asked.
