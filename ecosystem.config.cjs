const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "panovapro",
      cwd: __dirname,
      script: path.join(".output", "server", "index.mjs"),
      interpreter: "node",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOST: "127.0.0.1",
      },
    },
  ],
};
