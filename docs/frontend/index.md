# Frontend Documentation

## 1. Overview

The AquaTrace web frontend is maintained in the [cytech-frontend repository](https://github.com/akirachix/cytech-frontend).

The application uses Next.js, React, and TypeScript and is hosted on Vercel. It provides the user interface through which authorised users access monitoring information and supported operational workflows. The designs describe it as an installable Progressive Web App (PWA) so that officers can use it on a phone in the field.

The frontend communicates with the backend through API clients. Business rules, validation, and authorization must be enforced by the backend rather than relying exclusively on frontend restrictions.

### Status labels used on this page

| Label | Meaning |
|---|---|
| **Verified** | Confirmed from the repository or an agreed project artefact |
| **Designed** | Shown in the approved screen designs or user flows; confirm against the code |
| **Illustrative** | A code sketch that shows the intended pattern; take the real names from the repository |

## 2. Main Responsibilities

The frontend is responsible for:

- Presenting monitoring and device information.
- Supporting navigation through available application workflows.
- Collecting user input and displaying validation feedback.
- Calling backend APIs through the project's API modules.
- Showing loading, empty, success, and error states.
- Displaying historical records and pagination where supported.
- Presenting useful feedback when requests fail.
- Showing only the navigation that matches the signed-in user's role.

The frontend should not connect directly to PostgreSQL or communicate directly with physical monitoring devices.

## 3. Technology Stack

| Technology | Purpose | Status |
|---|---|---|
| Next.js | Web application framework | Verified |
| React | User interface and interactive components | Verified |
| TypeScript | Static typing | Verified |
| TanStack Form | Form state and field management where used | Verified |
| ESLint | Code-quality checks | Verified |
| Prettier | Consistent code formatting | Verified |
| Vercel | Hosting | Designed |
| Inria Serif | Typeface from the style guide | Designed |

Exact dependency versions should be confirmed in the frontend repository's `package.json` and lockfile.

## 4. Design System

The visual identity comes from the AquaTrace style guide. Click the image to open it full screen.

<a href="/style-guide.png" target="_blank">
  <img src="/style-guide.png" alt="AquaTrace Style Guide. Click to open full size." style="max-width: 100%; height: auto;" />
</a>

### Colours

| Role | Name | Hex | Use |
|---|---|---|---|
| Primary | Dark teal | `#0C6E77` | Sidebar, primary buttons, links |
| Primary | Bright teal | `#1ABCB4` | Accent buttons, highlights, logo text |
| Secondary | Mid teal | `#2A9D8F` | Secondary buttons, success tones |
| Secondary | Coral | `#E76F51` | Alerts, destructive or attention actions |
| Secondary | Navy | `#264653` | Headings, dark buttons |


### Typography and components

- Typeface: **Inria Serif** in regular, bold and italic weights.
- Buttons are pill-shaped and come in the five colours above. Labels in the guide include View nodes, Contact Us, Log in, Save, Assign, View history and Create incident.
- Icons in the guide: location pin, search, lightning bolt (electrical conductivity), droplets (turbidity), gauge, history clock, bell (alerts), trash, logout and pencil.

A shared token file keeps these values in one place:

```ts
export const colors = {
  tealDark: "#0C6E77",
  tealBright: "#1ABCB4",
  tealMid: "#2A9D8F",
  coral: "#E76F51",
  navy: "#264653",
} as const;

export const fonts = {
  body: "'Inria Serif', Georgia, serif",
} as const;
```

If the project uses `next/font`, load the font once at the root layout instead of in each component:

```tsx
import { Inria_Serif } from "next/font/google";

const inria = Inria_Serif({ subsets: ["latin"], weight: ["300", "400", "700"], display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inria.className}>{children}</body>
    </html>
  );
}
```

## 5. Screens and Navigation

The sidebar changes with the role of the signed-in user.

| Role | Sidebar |
|---|---|
| Water Quality Officer, Field Officer | Dashboard, Nodes, Alerts, Incidents, Reports, Settings, Profile |
| Administrator | Users, Audit log, My profile |

### Operational screens (Designed)

| Screen | Purpose | Main data |
|---|---|---|
| Log in | Email and password sign-in. Accounts are created by an administrator, so there is no sign-up. | `POST /auth/login` |
| Two-step verification | Six-digit code from an authenticator app | `POST /auth/verify-mfa` |
| Dashboard | Water quality score, active alerts, devices online, latest readings per node, advisory explanation | `GET /sensor-readings/latest`, `GET /alerts`, `GET /api/v1/devices` |
| Nodes | List of nodes with status, location, details, calibration and maintenance history, and node registration | `GET` and `POST /api/v1/devices`, `GET /maintenance-records` |
| Alerts | Alerts with search, filters (All, New, Seen, High, Medium, Low), grouped repeats, explanation, Create incident and Mark as seen | `GET /alerts`, `PATCH /alerts/{alert_id}/seen` |
| Incident | Five-stage tracker, assignment, evidence summary, field notes, follow-up readings, history, Mark as resolved | Incident routes to be confirmed, `GET /lab-tests` |
| History and comparing places | Compare the same reading at two places, date range, past alerts and incidents, Create report | `GET /sensor-readings/device/{device_id}`, `GET /alerts` |
| Settings | Limits for each reading and the approved procedures used by the AI assistant. Only administrators can change these. | Route to be confirmed |

### Administration screens (Designed)

| Screen | Purpose | Main data |
|---|---|---|
| Users | Table with role, status (Active, Inactive, Locked), two-step status and created date, filters for role and status | `GET /users` |
| Create user | First name, last name, email, role, password with live rule checks | `POST /users` |
| User detail | Change role and status, unlock a locked account, link to the user's audit entries | `GET /users/{user_id}`, `POST /users/{user_id}/activate`, `POST /users/{user_id}/deactivate` |
| Audit log | Filters for action, user, entity and dates; read-only list | `GET /audit-logs` |
| Audit entry | Read-only record with before and after values and raw details | `GET /audit-logs/{audit_log_id}` |
| My profile | Personal details, change password, two-step verification status | `GET` and `PATCH /users/me`, `POST /auth/change-password` |
| Set up authenticator | QR code and manual key, six-digit confirmation | `POST /auth/mfa/setup`, `POST /auth/mfa/setup/verify` |

## 6. Nodes Page Structure

The Nodes page is located under `src/app/provider/nodes/` in the frontend repository.

The refactored interface separates the main UI responsibilities into components:

| File | Responsibility |
|---|---|
| `nodes.tsx` | Coordinates page state, API requests, node selection, and layout |
| `components/NodeRegistration.tsx` | Node registration form |
| `components/NodeOverview.tsx` | Summary cards and selected-node details |
| `components/NodeReadings.tsx` | Water-quality readings |
| `components/NodeMaintenance.tsx` | Maintenance records and pagination |

The refactor was pushed in commit `d422368` on `feature/nodes-monitoring-ui`. Confirm the pull request's merge status before treating it as part of the released application.

### Composition (Illustrative)

The coordinating component owns the state and passes data down. The child components stay presentational.

```tsx
"use client";
import { useEffect, useState } from "react";
import NodeRegistration from "./components/NodeRegistration";
import NodeOverview from "./components/NodeOverview";
import NodeReadings from "./components/NodeReadings";
import NodeMaintenance from "./components/NodeMaintenance";

export default function NodesPage() {
  const [nodes, setNodes] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    listDevices()
      .then((d) => { setNodes(d); setSelectedId(d[0]?.device_id ?? null); setState("ready"); })
      .catch(() => setState("error"));
  }, []);

  const selected = nodes.find((n) => n.device_id === selectedId) ?? null;

  if (state === "loading") return <p>Loading nodes...</p>;
  if (state === "error") return <p role="alert">Could not load nodes. Try again.</p>;

  return (
    <>
      <NodeRegistration onCreated={(n) => setNodes((prev) => [n, ...prev])} />
      <NodeOverview nodes={nodes} selected={selected} onSelect={setSelectedId} />
      {selected && <NodeReadings deviceId={selected.device_id} />}
      {selected && <NodeMaintenance deviceId={selected.device_id} />}
    </>
  );
}
```

### Node registration form with TanStack Form (Illustrative)

Field names must match the device schema in the backend OpenAPI document.

```tsx
import { useForm } from "@tanstack/react-form";

export default function NodeRegistration({ onCreated }: { onCreated: (d: Device) => void }) {
  const form = useForm({
    defaultValues: { serial_number: "", name: "", latitude: "", longitude: "" },
    onSubmit: async ({ value }) => {
      const device = await createDevice({
        serial_number: value.serial_number.trim(),
        name: value.name.trim(),
        latitude: Number(value.latitude),
        longitude: Number(value.longitude),
      });
      onCreated(device);
      form.reset();
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      <form.Field
        name="serial_number"
        validators={{ onChange: ({ value }) => (value.trim() ? undefined : "Serial number is required") }}
      >
        {(field) => (
          <label>
            Serial number
            <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
            {field.state.meta.errors[0] && <span role="alert">{field.state.meta.errors[0]}</span>}
          </label>
        )}
      </form.Field>

      <form.Field
        name="latitude"
        validators={{
          onChange: ({ value }) => {
            const n = Number(value);
            return Number.isFinite(n) && n >= -90 && n <= 90 ? undefined : "Latitude must be between -90 and 90";
          },
        }}
      >
        {(field) => (
          <label>
            Latitude
            <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
            {field.state.meta.errors[0] && <span role="alert">{field.state.meta.errors[0]}</span>}
          </label>
        )}
      </form.Field>

      <button type="submit">Register node</button>
    </form>
  );
}
```

Client-side checks improve feedback only. The backend repeats them, including the serial-number uniqueness check, and its response is the source of truth.

## 7. API Integration

The frontend communicates with the backend through its API modules and shared HTTP client.

API requests should use the configured API base URL and handle unsuccessful responses consistently. The backend remains responsible for request validation, business rules, and authorization.

Document exact request paths and response fields using the backend OpenAPI schema and the frontend API implementation.

### Shared client (Illustrative)

FastAPI returns errors as JSON with a `detail` field. For ordinary errors `detail` is a string. For request validation failures (`422`) it is a list of objects with `loc`, `msg` and `type`. The client should turn both into one error type.

```ts
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError(0, "Network error. Check your connection and try again.");
  }

  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

  const body = await res.json().catch(() => ({}));
  if (res.status === 422 && Array.isArray(body.detail)) {
    const fields: Record<string, string> = {};
    for (const item of body.detail) fields[String(item.loc?.at(-1))] = item.msg;
    throw new ApiError(422, "Please correct the highlighted fields.", fields);
  }
  throw new ApiError(res.status, typeof body.detail === "string" ? body.detail : "Something went wrong.");
}
```

### Typed endpoint modules (Illustrative)

```ts
export type SensorReading = {
  reading_id: string;
  device_id: string;
  message_number: number;
  ph: number | null;
  temperature: number | null;
  turbidity: number | null;
  electrical_conductivity: number | null;
  wqi_score: number | null;
  wqi_status: string | null;
  sensor_status: string;
  is_buffered: boolean;
  recorded_at: string; 
};

export const getLatestReadings = (token: string) =>
  apiFetch<SensorReading[]>("/sensor-readings/latest", { token });

export const getDeviceReadings = (deviceId: string, token: string) =>
  apiFetch<SensorReading[]>(`/sensor-readings/device/${deviceId}`, { token });
```

::: tip
`GET /sensor-readings/` and `GET /sensor-readings/device/{device_id}` accept a `limit` (default 100) in the backend service. Add the query parameter in the client when you need more or fewer rows.
:::

## 8. Authentication in the Interface

| Concern | Intended behaviour | Status |
|---|---|---|
| Sign-in | Email and password, with a generic error on failure | Designed |
| Lockout | After repeated failed attempts the account is locked and an administrator can unlock it | Designed |
| Two-step verification | If enabled, the user is asked for a six-digit code after the password step | Designed |
| Token handling | Access token attached to requests, refresh through `POST /auth/refresh` | To verify |
| Session expiry | Redirect to sign-in and keep the user's intended destination | To verify |
| Route protection | Pages check the signed-in role and redirect when it does not match | To verify |

Where the tokens are stored must be confirmed in the repository. Avoid keeping long-lived tokens in `localStorage`, because any script injected into the page could read them.

### Password rules on the Create user and Change password screens

The screens show a live checklist: at least 8 characters, a number and a special character. The same rules are enforced by the backend.

```ts
export const passwordRules = [
  { id: "length", label: "At least 8 characters", test: (v: string) => v.length >= 8 },
  { id: "number", label: "Contains a number", test: (v: string) => /\d/.test(v) },
  { id: "special", label: "Contains a special character", test: (v: string) => /[^A-Za-z0-9]/.test(v) },
] as const;

export const isPasswordValid = (v: string) => passwordRules.every((r) => r.test(v));
```

### Role-Based Access Control (Illustrative)

```tsx
const NAV_BY_ROLE: Record<Role, { label: string; href: string }[]> = {
  admin: [
    { label: "Users", href: "/admin/users" },
    { label: "Audit log", href: "/admin/audit-log" },
    { label: "My profile", href: "/profile" },
  ],
  water_quality_officer: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Nodes", href: "/provider/nodes" },
    { label: "Alerts", href: "/alerts" },
    { label: "Incidents", href: "/incidents" },
    { label: "Reports", href: "/reports" },
    { label: "Settings", href: "/settings" },
    { label: "Profile", href: "/profile" },
  ],
  field_officer:
};
```

::: warning
Hiding a link is a convenience, not security. Every route must still be protected by the backend.
:::

## 9. Presenting Measurements and Status

The interface shows raw measurements and the calculated WQI separately, in line with the architecture rules.

| WQI status (from the backend) | Meaning of the band |
|---|---|
| Excellent | Score above 79 |
| Good | Above 51 up to 79 |
| Regular | Above 36 up to 51 |
| Poor | Above 19 up to 36 |
| Very Poor | 19 or below |

```ts
export const wqiStyles: Record<string, { bg: string; fg: string }> = {
  Excellent: { bg: "#E6F4F1", fg: "#0C6E77" },
  Good:      { bg: "#E8F5EC", fg: "#1B6B3A" },
  Regular:   { bg: "#FFF3D6", fg: "#8A5A00" },
  Poor:      { bg: "#FDE7E0", fg: "#B4381B" },
  "Very Poor": { bg: "#F9D6CE", fg: "#8F2410" },
};
```

Other presentation rules from the designs:

- Readings received late are marked as buffered (`is_buffered`) so they are not mistaken for live values.
- A reading without a WQI score (for example when a sensor reports a fault) is shown as unavailable, not as zero.
- Times are stored in UTC. The audit log screens state that times are UTC.
- AI explanations always carry the "Advice only" label and the statement that they do not confirm a cause.

## 10. Error Handling

The interface should distinguish loading, empty results, validation errors, authorization failures, missing resources, and server or network failures.

Where the backend returns a useful error message, the frontend should preserve it when safe to display. Generic messages should be used when a specific error is unavailable.

| Status | Meaning | Suggested interface behaviour |
|---|---|---|
| 0 | Network failure | Banner: "Check your connection". Offer retry. |
| 401 | Not signed in or session expired | Try refresh once, then go to sign-in |
| 403 | Role not permitted | Show a "not allowed" message, do not retry |
| 404 | Missing resource | Show a "not found" state with a way back |
| 409 | Conflict, for example a duplicate serial number | Show the message next to the field |
| 422 | Validation failed | Show each message beside its field |
| 429 | Rate limited | Ask the user to wait and try again |
| 5xx | Server error | Generic message and retry; never show the stack trace |

## 11. Progressive Web App Behaviour

The designs describe an installable PWA. Confirm what is implemented before documenting it as done.

| Item | Intended behaviour | Status |
|---|---|---|
| Web app manifest | Name, icons, theme colour `#0C6E77`, `display: standalone` | To verify |
| Service worker | Cache the application shell and static assets | To verify |
| API caching | Do not cache authenticated API responses or tokens | To verify |
| Offline | Show a clear offline message; do not display stale readings as live | To verify |

```json
{
  "name": "AquaTrace",
  "short_name": "AquaTrace",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F5F8F9",
  "theme_color": "#0C6E77",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

## 12. Accessibility and Responsive Layout

- Every form control has a visible label, and errors use `role="alert"` so screen readers announce them.
- Status is never shown by colour alone. Badges include text such as Active, Locked or Critical.
- Controls are reachable by keyboard and show a visible focus state.
- Wide tables scroll inside their own container so the page does not scroll sideways on a phone.
- Check layouts at phone, tablet and desktop widths, because field officers will use phones.

## 13. Configuration

Environment variables are set in Vercel for each environment. Names below are illustrative; use the ones in the repository.

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Variables prefixed with `NEXT_PUBLIC_` are visible in the browser. Never put secrets, API keys for external services or database credentials in them.

## 15. Testing and Quality Checks

Run these commands from the frontend repository:

```bash
npm run lint
npm run build
npx prettier@3.6.2 --check .
```

The frontend repository also uses Prettier for formatting checks. Follow the scripts and Git hooks defined in that repository.

A successful production build confirms that the code compiles, but it does not prove that every workflow behaves correctly in the browser.

Browser verification should cover:

- Loading the Nodes page and displaying the node list.
- Registering a node and handling validation errors.
- Selecting a node and displaying its details.
- Displaying available readings and WQI information.
- Navigating maintenance records across pages.
- Handling empty responses and API failures.
- Checking the layout at different viewport sizes.

Document a test as passed only after it has actually been executed.

## 16. Related Documentation

- [System Overview](../overview/)
- [System Architecture](../overview/architecture)
- [Data Flow](../overview/data-flow)
- [Backend API](../backend/)
- [Database](../database/)
- [IoT Monitoring](../iot/)
- [WQI](../wqi/)
- [Security](../security/)