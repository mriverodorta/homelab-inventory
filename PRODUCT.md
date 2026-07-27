# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Homelab owners and operators who need to document physical hardware, installed components, ports, cabling, power delivery, and operational context. The primary user is a self-hoster working from a trusted LAN, VPN, or authenticated reverse proxy on desktop or mobile.

## Product Purpose

Homelab Inventory is a self-hosted visual workbench that makes it practical to understand what hardware a lab contains, what is installed in each host, where equipment is placed, and how network, display, and power endpoints are connected.

Success means a user can build and maintain an accurate inventory and topology without storing their operational data inside the application image or depending on a hosted service.

## Positioning

The product combines structured hardware inventory, compatibility-aware component assignment, explicit physical ports, and a free-form cable canvas in one local-first application. It is not an enterprise CMDB and does not require a cloud account for its core workflows.

## Operating Context

- Self-hosted with Docker or installed directly with Bun.
- Runtime data is persisted outside the application image under `/data` and migrated in order across schema versions.
- The application is usable without agents, integrations, or internet access.
- Optional connected features must be explicit, independently disableable, and transparent about outbound data.
- Users work with incomplete and heterogeneous consumer, OEM, server, network, storage, display, and power hardware.

## Capabilities and Constraints

- Inventory categories use positive numeric IDs and category-scoped relationships so persisted data can migrate to a relational database later.
- Hosts accept compatible independent component records; standalone equipment exposes explicit connectable ports.
- Compatibility rules distinguish verified incompatibility from unknown data and can be disabled or selectively ignored.
- The canvas supports network, display, and power connections with orthogonal routing implemented through a Rust WASM engine.
- Production installations start without personal seed data.
- Built-in authentication is not currently available; internet-facing deployments require a trusted VPN or authenticated TLS reverse proxy.
- The optional community catalog supports signed connected synchronization, signed offline snapshots, and explicit opt-in sanitized hardware contributions without changing local core workflows.
- Private templates provide local reusable hardware definitions with checksummed import/export independently of the official catalog.

## Brand Commitments

- Product name: Homelab Inventory.
- Official website: https://homelabinventory.com/
- Public demo: https://demo.homelabinventory.com/
- Voice: direct, practical, transparent about limitations, and oriented toward self-hosters.
- AI-assisted development and catalog enrichment must be disclosed; AI output is never treated as automatically verified truth.

## Evidence on Hand

- The repository contains a fictional first-run example workspace and a public interactive demo.
- Existing inventory forms cover servers, NAS devices, PC builds, components, switches, patch panels, monitors, UPS systems, and power strips.
- The application includes schema migrations, runtime backups, release notes, multi-architecture Docker images, compatibility audits, and automated tests.
- No customer testimonials, enterprise compliance claims, or universal hardware dataset are currently established and must not be fabricated.

## Product Principles

1. Keep operational inventory local by default.
2. Make connected behavior explicit, inspectable, and reversible.
3. Preserve user edits and relationships across imports, updates, and migrations.
4. Prefer deterministic validation and canonical data over silent inference.
5. Treat community data and AI enrichment as untrusted until reviewed.

## Accessibility & Inclusion

Core inventory, settings, dialogs, and canvas controls must remain keyboard operable, responsive on mobile, and understandable without relying on color alone.
