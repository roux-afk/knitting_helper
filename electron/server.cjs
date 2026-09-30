// Runs in Electron's Node utility process, never in the renderer.
const path=require('node:path');
process.env.NODE_ENV='production';
process.env.HOSTNAME='127.0.0.1';
require(path.join(process.env.KNITTING_SERVER_DIR,'server.js'));
