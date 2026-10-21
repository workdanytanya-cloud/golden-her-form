import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const base = __ENV.BASE_URL || "http://localhost:18080";
const vus = Number(__ENV.VUS || 1);
const fileLatency = new Trend("file_latency", true);
export const options = {
  vus,
  duration: __ENV.DURATION || "60s",
  summaryTrendStats: ["avg", "med", "p(50)", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
    file_latency: ["p(95)<5000"],
  },
};

function login(email) {
  const csrfResponse = http.get(`${base}/api/selfhost/csrf`);
  const initialCsrf = csrfResponse.json("csrf");
  const response = http.post(
    `${base}/api/selfhost/login`,
    JSON.stringify({ email, password: __ENV.TEST_PASSWORD }),
    { headers: { "content-type": "application/json", "x-csrf-token": initialCsrf } },
  );
  check(response, { "auth 200": (r) => r.status === 200 });
  const csrf = response.json("csrf");
  const session = response.cookies.panovapro_session?.[0]?.value;
  const csrfCookie = response.cookies.panovapro_csrf?.[0]?.value;
  return { csrf, cookie: `panovapro_session=${session}; panovapro_csrf=${csrfCookie}` };
}

export function setup() {
  return {
    a: login(__ENV.CLIENT_A_EMAIL),
    b: login(__ENV.CLIENT_B_EMAIL),
  };
}

export default function (sessions) {
  const course = __VU % 2 ? __ENV.CLIENT_A_COURSE : __ENV.CLIENT_B_COURSE;
  const auth = __VU % 2 ? sessions.a : sessions.b;
  const headers = {
    "x-csrf-token": auth.csrf,
    "content-type": "application/json",
    cookie: auth.cookie,
  };
  const paths = [
    "/",
    "/dashboard",
    "/dashboard/nutrition",
    "/dashboard/training",
    "/dashboard/profile",
  ];
  for (const path of paths)
    check(http.get(`${base}${path}`, { headers: { cookie: auth.cookie } }), {
      [`${path} ok`]: (r) => r.status < 500,
    });
  for (const kind of ["nutrition", "training"]) {
    const response = http.post(
      `${base}/api/selfhost/pdf`,
      JSON.stringify({ kind, courseId: course }),
      { headers },
    );
    fileLatency.add(response.timings.duration);
    check(response, { [`${kind} pdf bounded`]: (r) => r.status === 200 || r.status === 404 });
  }
  if (__VU % 2) {
    for (const id of [__ENV.PDF_DOCUMENT_ID, __ENV.DOCX_DOCUMENT_ID]) {
      if (!id) continue;
      const response = http.get(`${base}/api/selfhost/nutrition-documents/${id}/view`, {
        headers: { cookie: auth.cookie },
      });
      fileLatency.add(response.timings.duration);
      check(response, { "uploaded document 200": (r) => r.status === 200 });
    }
  }
  sleep(1);
}
