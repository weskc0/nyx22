self.__uv$config = {
  prefix: "/service/",
  bare: (location.hostname === "localhost" || location.hostname === "127.0.0.1") && (!location.port || location.port === "8080")
    ? "/wisp/"
    : "wss://wisp.mercurywork.shop/",
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: "/uv/uv.handler.js",
  bundle: "/uv/uv.bundle.js",
  config: "/uv.config.js",
  sw: "/uv.sw.js?v=nyx-uv-v7-20260801-critical-asset-recovery",
  client: "/uv/uv.client.js"
};
