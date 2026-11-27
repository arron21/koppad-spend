import app from '../dist-server/server/index.js';

export default function handler(req, res) {
  return app(req, res);
}
