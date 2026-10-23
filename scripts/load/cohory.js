// k6 load test for REQ-NFR-PERF-004 and REQ-NFR-PERF-005. Run it with scripts/load/run.sh,
// which seeds the members and posts it needs and pins the k6 image.
//
// Each virtual user signs in once as its own member, then loops: read the feed, read a lesson,
// read the calendar, and on every fifth iteration create a post. Requests are tagged by name, so
// the summary has a p95 per endpoint.
import http from "k6/http";
import { check, fail, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:3940";
const slug = __ENV.COMMUNITY_SLUG || "cohory-creators";
const password = __ENV.LOAD_PASSWORD || "cohory-load-password";
const vus = Number(__ENV.VUS || 100);
const duration = __ENV.DURATION || "3m";
const thinkSeconds = Number(__ENV.THINK_SECONDS || 1);

export const options = {
  scenarios: {
    active_members: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: vus },
        { duration, target: vus },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    "http_req_duration{name:feed}": ["p(95)<300"],
    "http_req_duration{name:lesson}": ["p(95)<300"],
    "http_req_duration{name:calendar}": ["p(95)<300"],
    "http_req_duration{name:post_create}": ["p(95)<500"],
    "http_req_duration{name:sign_in}": ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const origin = __ENV.ORIGIN || baseUrl;
const jsonHeaders = { "content-type": "application/json", origin };

export function setup() {
  const owner = signIn("owner@cohory.local", "cohory-dev-password", "setup");
  const course = http.get(`${baseUrl}/api/v1/communities/${slug}/courses`, {
    jar: owner,
    tags: { name: "setup" },
  });
  const courses = course.json("data") || course.json();
  const first = Array.isArray(courses) ? courses[0] : null;
  if (!first) fail(`no course in ${slug}: ${course.status} ${course.body}`);
  const detail = http.get(`${baseUrl}/api/v1/communities/${slug}/courses/${first.slug}`, {
    jar: owner,
    tags: { name: "setup" },
  });
  const lessons = (detail.json("modules") || [])
    .flatMap((module) => module.lessons || [])
    .filter((lesson) => lesson.status === "published");
  if (lessons.length === 0) fail(`no lessons in ${first.slug}: ${detail.body}`);
  return { courseSlug: first.slug, lessonSlugs: lessons.map((lesson) => lesson.slug) };
}

function signIn(email, secret, name = "sign_in") {
  const jar = new http.CookieJar();
  const response = http.post(
    `${baseUrl}/api/auth/sign-in/email`,
    JSON.stringify({ email, password: secret }),
    { headers: jsonHeaders, jar, tags: { name } },
  );
  if (!check(response, { "signed in": (r) => r.status === 200 })) {
    fail(`sign in failed for ${email}: ${response.status}`);
  }
  return jar;
}

let jar = null;

function range() {
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 35 * 86_400_000).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

export default function (data) {
  if (jar === null) {
    jar = signIn(`load-${String(__VU).padStart(4, "0")}@example.test`, password);
  }

  const feed = http.get(`${baseUrl}/api/v1/communities/${slug}/posts`, {
    jar,
    tags: { name: "feed" },
  });
  check(feed, { "feed 200": (r) => r.status === 200 });
  sleep(thinkSeconds);

  const lessonSlug = data.lessonSlugs[__ITER % data.lessonSlugs.length];
  const lesson = http.get(
    `${baseUrl}/api/v1/communities/${slug}/courses/${data.courseSlug}/lessons/${lessonSlug}`,
    { jar, tags: { name: "lesson" } },
  );
  check(lesson, { "lesson 200": (r) => r.status === 200 });
  sleep(thinkSeconds);

  const calendar = http.get(
    `${baseUrl}/api/v1/communities/${slug}/calendar/occurrences?${range()}`,
    {
      jar,
      tags: { name: "calendar" },
    },
  );
  check(calendar, { "calendar 200": (r) => r.status === 200 });
  sleep(thinkSeconds);

  if (__ITER % 5 === 0) {
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `Load test post ${__VU}-${__ITER}` }],
        },
      ],
    };
    const created = http.post(
      `${baseUrl}/api/v1/communities/${slug}/posts`,
      JSON.stringify({ body }),
      { headers: jsonHeaders, jar, tags: { name: "post_create" } },
    );
    check(created, { "post 201": (r) => r.status === 201 || r.status === 200 });
    sleep(thinkSeconds);
  }
}

export function handleSummary(data) {
  const names = ["sign_in", "feed", "lesson", "calendar", "post_create"];
  const rows = names.map((name) => {
    const metric = data.metrics[`http_req_duration{name:${name}}`];
    const values = metric ? metric.values : {};
    return { name, p95: values["p(95)"], p99: values["p(99)"], med: values.med, max: values.max };
  });
  const out = {
    vus,
    duration,
    requests: data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0,
    failedRate: data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : null,
    endpoints: rows,
  };
  return {
    stdout: `${JSON.stringify(out, null, 2)}\n`,
    [__ENV.SUMMARY_PATH || "/out/summary.json"]: JSON.stringify(data, null, 2),
  };
}
