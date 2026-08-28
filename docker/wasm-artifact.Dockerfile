FROM rust:1.94.1-alpine@sha256:77237dd363a0b127bb5ef532c2d64c0deb380b738e43a9c4bdac73398d6d0a08 AS build
WORKDIR /app
RUN apk add --no-cache binaryen=123-r1 libstdc++=15.2.0-r2 musl-dev=1.2.5-r23 \
  && rustup target add wasm32-unknown-unknown
COPY rust ./rust
COPY rust-toolchain.toml ./
RUN cargo build --release --manifest-path rust/Cargo.toml -p homelab-engine-wasm --target wasm32-unknown-unknown \
  && wasm-opt -Oz rust/target/wasm32-unknown-unknown/release/homelab_engine_wasm.wasm \
    -o /homelab_engine.wasm \
  && { rustc --version; cargo --version; wasm-opt --version; } > /toolchain.txt

FROM scratch
COPY --from=build /homelab_engine.wasm /wasm/homelab_engine.wasm
COPY --from=build /toolchain.txt /wasm/toolchain.txt
