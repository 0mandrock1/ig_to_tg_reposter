module.exports = {
  apps: [
    {
      name: 'ig-to-tg-reposter',
      script: 'dist/index.js',
      cwd: __dirname,
      watch: false,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
