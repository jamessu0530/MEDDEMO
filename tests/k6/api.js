import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const scenario = __ENV.SCENARIO || 'smoke';
if (!['smoke', 'read'].includes(scenario)) throw new Error('SCENARIO must be smoke or read');
const base = (__ENV.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const address = /^(https?):\/\/(\[[\da-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::\d+)?$/.exec(base);
if (!address) throw new Error('BASE_URL must be an http(s) origin without credentials, path or query');
if (!['localhost', '127.0.0.1', '[::1]'].includes(address[2]) && __ENV.ALLOW_REMOTE !== 'true') {
  throw new Error('Remote tests require ALLOW_REMOTE=true');
}
if (__ENV.ALLOW_REMOTE === 'true' && address[1] !== 'https' && !['localhost', '127.0.0.1', '[::1]'].includes(address[2])) {
  throw new Error('Remote tests require HTTPS');
}
const vus = Number(__ENV.VUS || (scenario === 'read' ? 20 : 1));
if (!Number.isInteger(vus) || vus < 1 || vus > 100) throw new Error('VUS must be an integer from 1 to 100');
const pause = Number(__ENV.THINK_TIME || 1);
if (!Number.isFinite(pause) || pause < 0) throw new Error('THINK_TIME must be a nonnegative number');
const projectId = Number(__ENV.K6_CLOUD_PROJECT_ID || 8492083);
if (!Number.isInteger(projectId) || projectId < 1) throw new Error('K6_CLOUD_PROJECT_ID must be a positive integer');

export const options = {
  scenarios: {
    [scenario]: {
      executor: 'constant-vus',
      vus,
      duration: __ENV.DURATION || (scenario === 'read' ? '1m' : '10s'),
      gracefulStop: '10s',
    },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    http_reqs: ['count>0'],
    iterations: ['count>0'],
  },
  // Group request metrics by route. Cloud k6 requires the error tag as well.
  systemTags: ['status', 'method', 'name', 'group', 'check', 'error', 'error_code', 'scenario', 'expected_response'],
  tags: { service: 'meddemo', profile: scenario, target: address[2] },
  cloud: {
    name: scenario === 'smoke' ? 'MEDDEMO 基本檢查' : 'MEDDEMO 登入後查詢壓測',
    projectID: projectId,
  },
};

function request(path, name, token, validate) {
  const response = http.get(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    tags: { name },
    timeout: '10s',
    redirects: 0,
  });
  const valid = check(response, {
    [`${name}：回應成功且資料格式正確`]: (res) => {
      if (res.status !== 200) return false;
      try { return validate(res.json()); } catch { return false; }
    },
  });
  return valid ? response.json() : null;
}

export function setup() {
  if (scenario === 'smoke') return {};
  let token = __ENV.K6_TOKEN;
  if (!token) {
    if (!__ENV.K6_EMAIL || !__ENV.K6_PASSWORD) {
      exec.test.abort('read requires K6_TOKEN or both K6_EMAIL and K6_PASSWORD');
    }
    // Login only once: logging in per VU would invalidate other VUs' sessions.
    const login = http.post(`${base}/api/auth/login`, JSON.stringify({
      email: __ENV.K6_EMAIL, password: __ENV.K6_PASSWORD,
    }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'POST /api/auth/login' }, timeout: '10s', redirects: 0,
    });
    let payload;
    try { payload = login.json(); } catch { /* Abort below without logging credentials. */ }
    if (login.status !== 200 || !payload || typeof payload.token !== 'string' || !payload.token) {
      exec.test.abort(`Login failed (HTTP ${login.status}); verify the dedicated test account`);
    }
    token = payload.token;
  }
  const user = request('/api/auth/me', 'GET /api/auth/me', token, (value) => typeof value.id === 'string');
  if (!user) exec.test.abort('Authentication preflight failed');
  const customers = request('/api/customers', 'GET /api/customers', token, Array.isArray);
  if (!customers || !customers.length || typeof customers[0].id !== 'string') {
    exec.test.abort('The test account must have at least one visible customer');
  }
  return { token, customerId: customers[0].id };
}

export default function (data) {
  if (scenario === 'smoke') {
    request('/health', 'GET /health', null, (value) => value.status === 'ok');
    request('/api/auth/providers', 'GET /api/auth/providers', null, (value) => value !== null && typeof value === 'object');
  } else {
    request('/api/auth/me', 'GET /api/auth/me', data.token, (value) => typeof value.id === 'string');
    request('/api/customers', 'GET /api/customers', data.token, Array.isArray);
    request(`/api/customers/${encodeURIComponent(data.customerId)}`, 'GET /api/customers/{customer_id}', data.token,
      (value) => value.id === data.customerId);
    request('/api/products', 'GET /api/products', data.token, Array.isArray);
    request('/api/channels', 'GET /api/channels', data.token, Array.isArray);
    request('/api/channels/unread', 'GET /api/channels/unread', data.token, (value) => typeof value.count === 'number');
  }
  sleep(pause);
}
