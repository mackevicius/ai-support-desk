import app from '../server.js';

const port = Number(process.env.PORT ?? 3001);
app.listen(port, '0.0.0.0', () => {
  console.log(`Support API listening on ${port}`);
});
