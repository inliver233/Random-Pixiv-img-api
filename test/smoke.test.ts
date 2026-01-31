import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { readableFromBuffer } from './helpers/mockStream';

describe('test harness', () => {
  it('supertest works (json)', async () => {
    const app = express();
    app.get('/health', (req, res) => res.json({ ok: true }));

    const res = await request(app).get('/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('supertest works (stream)', async () => {
    const app = express();
    app.get('/stream', (req, res) => {
      res.setHeader('Content-Type', 'application/octet-stream');
      readableFromBuffer(Buffer.from('hello')).pipe(res);
    });

    const binaryParser = (res: any, callback: (err: any, body: any) => void) => {
      res.setEncoding('binary');
      let data = '';
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => {
        callback(null, Buffer.from(data, 'binary'));
      });
    };

    const res = await request(app).get('/stream').buffer(true).parse(binaryParser).expect(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf8')).toBe('hello');
  });
});
