# TavetaHQ operations. `make help` lists targets.
#
# Prod-like stack:  make secrets && make up
# Dev stack:        make secrets && make up-dev

SHELL := /usr/bin/env bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help

COMPOSE      := docker compose -f docker-compose.yml
COMPOSE_DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml
IMAGES       := backend frontend edge
PREFIX       ?= $(shell grep -E '^DEVHQ_IMAGE_PREFIX=' .env 2>/dev/null | cut -d= -f2 || true)
PREFIX       := $(if $(PREFIX),$(PREFIX),ghcr.io/devhq/devhq)
TAG          ?= $(shell grep -E '^DEVHQ_TAG=' .env 2>/dev/null | cut -d= -f2 || true)
TAG          := $(if $(TAG),$(TAG),local)

# Scanner images, pinned by digest (bump together with CI).
TRIVY        := aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb
SYFT         := anchore/syft:v1.57.0@sha256:3c70e6d5979364cefdc22b51617a78fd264574d3bd6b4f84a351204147025e2a
HADOLINT     := hadolint/hadolint:v2.15.1-alpine@sha256:a1d49ae1a4e83c1dbad26b8c1ad7588c8bd1e04f4866b34ad3cac50335198552
ACTIONLINT   := rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667
SHELLCHECK   := koalaman/shellcheck:v0.11.0@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d

.PHONY: help secrets up up-dev down down-v logs ps migrate build test smoke scan sbom lint-infra backup restore-drill

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

secrets: ## Generate infra/secrets/* (idempotent) and .env
	@infra/scripts/gen-secrets.sh

up: ## Build and start the prod-like stack (https://$$DEVHQ_DOMAIN)
	$(COMPOSE) up -d --build --wait --wait-timeout 300 edge

up-dev: ## Start the dev stack (Vite HMR, source mounts, published ports)
	$(COMPOSE_DEV) up -d --build

down: ## Stop the stack (volumes kept)
	$(COMPOSE_DEV) down --remove-orphans

down-v: ## Stop the stack AND delete all data volumes
	$(COMPOSE_DEV) down -v --remove-orphans

logs: ## Follow logs (SERVICE=backend to filter)
	$(COMPOSE) logs -f --tail 100 $(SERVICE)

ps: ## Service status
	$(COMPOSE) ps -a

migrate: ## Run database migrations (one-shot)
	$(COMPOSE) run --rm migrate

build: ## Build all images
	$(COMPOSE) build

test: ## Lane checks: backend typecheck/lint/smoke, frontend typecheck/lint/build
	npm run typecheck --workspace=Backend
	npm run lint --workspace=Backend
	npm run smoke --workspace=Backend
	npm run typecheck --workspace=Frontend
	npm run lint --workspace=Frontend
	npm run build --workspace=Frontend

smoke: ## End-to-end smoke through the edge (stack must be up)
	@infra/scripts/smoke.sh

scan: ## Trivy: images (HIGH/CRITICAL with fixes) + repo filesystem
	@for img in $(IMAGES); do \
	  echo "== $(PREFIX)-$$img:$(TAG)"; \
	  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v devhq-trivy-cache:/root/.cache \
	    $(TRIVY) image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 $(PREFIX)-$$img:$(TAG); \
	done
	docker run --rm -v "$(CURDIR):/src:ro" -v devhq-trivy-cache:/root/.cache $(TRIVY) fs \
	  --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 \
	  --skip-dirs /src/infra/secrets --skip-dirs /src/node_modules /src

sbom: ## SPDX SBOMs for the built images into ./sbom/
	@mkdir -p sbom
	@for img in $(IMAGES); do \
	  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock $(SYFT) \
	    $(PREFIX)-$$img:$(TAG) -o spdx-json > sbom/$$img.spdx.json; \
	  echo "sbom/$$img.spdx.json"; \
	done

lint-infra: ## hadolint, actionlint, shellcheck, compose config
	@for f in Backend/Dockerfile Frontend/Dockerfile infra/edge/Dockerfile $$(ls Models/Dockerfile 2>/dev/null); do \
	  echo "hadolint $$f"; docker run --rm -i -v "$(CURDIR)/.hadolint.yaml:/.config/hadolint.yaml:ro" $(HADOLINT) hadolint - < $$f; done
	docker run --rm -v "$(CURDIR):/repo:ro" -w /repo $(ACTIONLINT) -color
	docker run --rm -v "$(CURDIR):/mnt:ro" -w /mnt $(SHELLCHECK) -x infra/scripts/*.sh infra/docker/*.sh infra/postgres/initdb/*.sh
	$(COMPOSE) config -q && $(COMPOSE_DEV) config -q && echo "compose: ok"

backup: ## Encrypted pg_dump to the MinIO backups bucket
	@infra/scripts/backup-db.sh

restore-drill: ## Restore the latest backup into a scratch DB and verify
	@infra/scripts/restore-db.sh latest --drill
