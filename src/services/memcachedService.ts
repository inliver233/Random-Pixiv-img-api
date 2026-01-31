import Memcached from 'memcached';

const memcached = new Memcached(`${process.env.MEMCACHED_HOST}:${process.env.MEMCACHED_PORT}`, { retries: 1 });

const generateKey = (key: string) => `${process.env.MEMCACHED_NAMESPACE}:${key}`;

const get = (key: string): Promise<any> => new Promise((resolve, reject) => {
  memcached.get(generateKey(key), (err: any, data: any) => {
    if (err) {
      reject(err);
    } else {
      resolve(data);
    }
  });
});

const set = (key: string, value: any, lifetime = 3600): Promise<void> => new Promise((resolve, reject) => {
  memcached.set(generateKey(key), value, lifetime, (err: any) => {
    if (err) {
      reject(err);
    } else {
      resolve();
    }
  });
});

const memcachedService = {
  get,
  set,
};

export default memcachedService;
