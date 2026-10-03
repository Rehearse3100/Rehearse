# Authentication Flow Audit

Read-only audit of the current Rehearse authentication and join flows.  
Date of investigation: 2026-08-22.  
Scope: code as present on the audited workspace; no behavior was changed for this document.

---

## 1. Professor Login (`app/(auth)/login/`)

### Plain-language findings

Professor login uses **Supabase Auth** (email + password) via the browser Supabase client. On success, the app checks the `profiles` table for `role === "teacher"`. Non-teacher accounts are signed out and rejected with a message directing them to Student Login. Successful teachers are sent to `/teacher/dashboard`, or to a `?redirect=` path if one was supplied (e.g. by middleware when hitting a protected teacher URL while logged out). Failure surfaces the Supabase error message (or the role-mismatch message) inline on the form. Session cookies are managed by Supabase SSR/auth (not a custom JWT cookie).

The server page also short-circuits: if a Supabase session already exists and the profile role is `teacher`, it redirects to `/teacher/dashboard` before rendering the form.

### Evidence

**Mechanism — Supabase `signInWithPassword`:**

```52:65:app/(auth)/login/LoginForm.tsx
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    const supabase = createClient();
    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setIsLoading(false);
      return;
    }
```

**Role gate + success redirect:**

```67:82:app/(auth)/login/LoginForm.tsx
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", authData.user?.id ?? "")
      .single();

    if (profile?.role !== "teacher") {
      await supabase.auth.signOut();
      setError("This page is for professors. Students should use Student Login.");
      setIsLoading(false);
      return;
    }

    const redirectTo = searchParams.get("redirect") ?? "/teacher/dashboard";
    router.push(redirectTo);
    router.refresh();
```

**Server-side already-logged-in redirect:**

```22:37:app/(auth)/login/page.tsx
  if (url && key) {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (profile?.role === "teacher") {
        redirect("/teacher/dashboard");
      }
    }
  }
```

**Client session pre-check** (same role + redirect logic): `app/(auth)/login/LoginForm.tsx` lines 25–50.

---

## 2. Professor Register (`app/(auth)/register/`)

### Plain-language findings

Registration is a single client page (no separate form component). Fields collected: **full name**, **email**, **password** (min 6), and a required **role** card (`student` or `teacher`). It calls Supabase Auth `signUp` and passes `full_name` and `role` in user metadata. There is **no explicit insert into `profiles` in the app code**; a database trigger `handle_new_user` (documented in schema SQL) inserts a `profiles` row from that metadata after `auth.users` insert. On success, the client redirects to `/teacher/dashboard` if role is `teacher`, otherwise `/student/dashboard`. Failure shows the Supabase signup error.

Important fact: selecting role `student` on this Supabase register path creates a **Supabase Auth user + `profiles` row**, not a row in the custom `students` table used by the JWT student portal.

### Evidence

**Fields + `signUp` + redirect:**

```27:47:app/(auth)/register/page.tsx
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!role) {
      setError("Please select whether you are a student or teacher.");
      return;
    }
    setIsLoading(true);
    setError("");
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role } },
    });
    if (signUpError) {
      setError(signUpError.message);
      setIsLoading(false);
      return;
    }
    router.push(role === "teacher" ? "/teacher/dashboard" : "/student/dashboard");
    router.refresh();
  };
```

**Form fields UI:** `app/(auth)/register/page.tsx` lines 55–111 (full name, email, password, role cards).

**Profiles creation via DB trigger (not app code):**

```18:39:supabase/FULL-SETUP.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
...
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

(Same pattern also appears in `supabase/archive/schema.sql` lines 105–121.)

---

## 3. Student Login (`app/student-login/`)

### Plain-language findings

Student login does **not** use Supabase Auth. The form POSTs to **`/api/student/login`** with `username` + `password`. The API looks up the `students` table, verifies a password hash, then creates a **custom JWT** stored in an **httpOnly cookie** named **`student_session`**, with **`maxAge` of 7 days** (`60 * 60 * 24 * 7`), `sameSite: "lax"`, `secure` in production, `path: "/"`. JWT expiry is also set to **7 days** via `STUDENT_SESSION_DAYS`. On success the client navigates to `/student/dashboard`. On failure the API error string is shown. If a valid student session already exists, the page server-redirects to the dashboard.

### Evidence

**Form → API:**

```22:42:app/student-login/StudentLoginForm.tsx
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const res = await fetch("/api/student/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    ...
    if (!res.ok) {
      setError(body.error ?? "Login failed.");
      return;
    }

    router.push("/student/dashboard");
```

**API: verify + create session:**

```31:52:app/api/student/login/route.ts
    const { data: student } = await supabase
      .from("students")
      .select("id, username, display_name, password_hash")
      .eq("username", username)
      .single();
    ...
    const valid = await verifyPassword(password, student.password_hash);
    ...
    await createStudentSession({
      studentId: student.id,
      username: student.username,
      displayName: student.display_name,
    });
```

**Cookie name / expiry:**

```21:30:lib/student-session.ts
export async function createStudentSession(data: StudentSession): Promise<void> {
  const token = await signStudentSessionToken(data);

  cookies().set(STUDENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}
```

```125:134:lib/constants.ts
export const STUDENT_SESSION_COOKIE = "student_session";
...
export const STUDENT_SESSION_DAYS = 7;
```

**Page already-session redirect:** `app/student-login/page.tsx` lines 20–24.

---

## 4. Student Register (`app/student-register/`)

### Plain-language findings

Fields collected: **display name**, **username** (3–20, letters/numbers/underscores), **password** (min length from constants), and **class code** (required in the HTML form; maxLength 6; uppercased). The page accepts an optional query param `?code=` which pre-fills the class code. Registration **requires a class code to complete** — both the form (`required`) and the API (length must equal `JOIN_CODE_LENGTH` = 6; reserved code `DEFAULT` is rejected).

On success the API:

1. Looks up an active `classes` row by `join_code`
2. Inserts a `students` row (username, display_name, password_hash)
3. Inserts a `student_classes` enrollment for that professor class
4. Also enrolls the student in the system default class (`DEFAULT_CLASS_ID`) via `enrollStudentInDefaultClass`
5. Sets the `student_session` JWT cookie

Then the client redirects to `/student/dashboard`. Failure shows the API error. An existing student session redirects away to the dashboard without registering again.

### Evidence

**`?code=` prefill + session redirect:**

```25:52:app/student-register/page.tsx
export default async function StudentRegisterPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const session = await getStudentSession();
  if (session) {
    redirect("/student/dashboard");
  }

  const initialJoinCode = searchParams.code?.trim().toUpperCase() ?? "";
  ...
        <StudentRegisterForm initialJoinCode={initialJoinCode} />
```

**Form requires Class Code + POST body:**

```45:53:app/student-register/StudentRegisterForm.tsx
    const res = await fetch("/api/student/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName,
        username,
        password,
        joinCode: joinCode.toUpperCase(),
      }),
    });
```

```112:123:app/student-register/StudentRegisterForm.tsx
      <label className="block text-sm font-medium text-text-primary">
        Class Code
        <input
          type="text"
          required
          maxLength={6}
          ...
```

**API creates `students` + enrollments + session:**

```60:130:app/api/student/register/route.ts
    if (joinCode.toUpperCase() === DEFAULT_CLASS_JOIN_CODE) {
      return NextResponse.json({ error: "Invalid class code." }, { status: 404 });
    }

    if (joinCode.length !== JOIN_CODE_LENGTH) {
      return NextResponse.json({ error: "Invalid class code." }, { status: 400 });
    }
    ...
    const { data: student, error: insertError } = await supabase
      .from("students")
      .insert({
        username,
        display_name: displayName,
        password_hash: passwordHash,
      })
      .select("id")
      .single();
    ...
    const enrollResult = await enrollStudentInClass(supabase, {
      studentId: student.id,
      classId: classRow.id,
      professorId: classRow.professor_id,
    });
    ...
    await enrollStudentInDefaultClass(supabase, student.id);

    await createStudentSession({
      studentId: student.id,
      username,
      displayName,
    });
```

`enrollStudentInClass` inserts into `student_classes` (`lib/student-enrollment.ts` lines 75–89).

---

## 5. Join-by-Code Flow (`app/join/` and `app/join/[joinCode]/`)

### Plain-language findings

**`/join` (no code in URL)**  
Landing page only. No database writes and no API calls. Copy tells new students to use the class code when creating an account, and returning students to sign in and join additional classes from the dashboard. CTAs: `/student-register` and `/student-login`.

**`/join/[joinCode]` (code in URL)**  
Designed as a **shareable invite landing** for a specific class: it reads `params.joinCode`, looks up class name / professor name / active flag from `classes` (+ `profiles` for professor name), and links Register to `/student-register?code=JOINCODE` (pre-fill). Sign In goes to `/student-login` with copy that says join from the dashboard (it does **not** pass the code into login or auto-enroll). This page itself **does not call an enrollment API** and **does not write** enrollments.

**Already-registered students joining another class**  
Neither join page enrolls a logged-in student. Additional-class enrollment is done after login via dashboard **Join a Class** → `POST /api/student/join-class`, which requires an existing `student_session` and inserts another `student_classes` row.

**What professors currently share**  
UI copy/constants point shareable “join links” at **`STUDENT_JOIN_PATH = "/join"`** (generic), with the **6-character code copied separately** — not at `/join/{CODE}`. The `/join/[joinCode]` route still exists and will work if someone constructs that URL manually or bookmarks it.

### Evidence

**Generic `/join` — no API, two links:**

```12:28:app/join/page.tsx
export default function JoinPage(): React.ReactElement {
  return (
    <AuthSplitLayout accent="gold" subtitle="Join your class on Rehearse.">
      ...
        Use the class code from your professor when you create an account. Returning students can
        sign in and join additional classes from the dashboard.
      ...
        <Link href="/student-register" ...>New student? Create your account</Link>
        <Link href="/student-login" ...>Already have an account? Sign in</Link>
```

**Code-in-URL landing → register prefill only:**

```17:21:app/join/[joinCode]/page.tsx
export default async function JoinClassPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const joinCode = params.joinCode.trim().toUpperCase();
  const registerHref = `/student-register?code=${encodeURIComponent(joinCode)}`;
```

Read-only class lookup: lines 27–50. Register / Sign In cards: lines 87–110. Displays code at bottom: lines 114–116.

**Logged-in additional join (dashboard, not join pages):**

```34:39:app/student/dashboard/JoinClassButton.tsx
    const res = await fetch("/api/student/join-class", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode: joinCode.trim().toUpperCase() }),
    });
```

```23:28:app/api/student/join-class/route.ts
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await getStudentSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
```

Writes: `enrollStudentInClass` → `student_classes` insert (`app/api/student/join-class/route.ts` lines 98–108).

**Professor share link is `/join`, not `/join/{code}`:**

```122:123:lib/constants.ts
/** Student onboarding entry — class code is never embedded in this URL. */
export const STUDENT_JOIN_PATH = "/join";
```

```81:85:components/TeacherClassesSection.tsx
  const joinUrl = (): string => {
    if (typeof window === "undefined") {
      return STUDENT_JOIN_PATH;
    }
    return `${window.location.origin}${STUDENT_JOIN_PATH}`;
  };
```

Same pattern: `components/ClassManagementClient.tsx` lines 48–51; `components/shared/Sidebar.tsx` lines 401–403, 827–830, 2056–2057. TeacherClassesSection copy (lines 93–95): “Share the join link… and give them the class code separately.”

---

## 6. Session / Auth Checking

### Plain-language findings

**Student APIs — `requireStudentApi()`** (`lib/api-auth.ts`): calls `getStudentSession()`; on missing/invalid session returns `{ ok: false, response: 401 JSON }`; on success returns `{ ok: true, session }`.

**Professor APIs — `requireProfessorApi()`** (`lib/api-auth.ts`): `createClient()` + `supabase.auth.getUser()`; missing user → 401; profile role not `teacher` → 403; else `{ ok: true, professorId }`.

**Professor pages — `requireRole("teacher")`** (`lib/auth-helpers.ts`): `getCurrentProfile()` via `auth.getUser()` + `profiles` select; no profile → redirect `/login`; wrong role → redirect to that role’s dashboard.

**Student pages:** middleware gates `/student/*`; `app/student/layout.tsx` also redirects to `/student-login` if `getStudentSession()` is null.

**Root `middleware.ts`:**

| Path prefix | Check | Unauthenticated redirect |
|-------------|--------|---------------------------|
| `/student/*` | Cookie `student_session` present + JWT verify | `/student-login` |
| `/teacher/*` | Supabase `auth.getUser()` | `/login?redirect=<pathname>` (or `/login` if env missing) |
| `/login`, `/register` | If Supabase user exists and profile role is `teacher` | `/teacher/dashboard` |

**Matcher:** only `"/teacher/:path*"`, `"/student/:path*"`, `"/login"`, `"/register"`.  
So `/student-login`, `/student-register`, and `/join*` are **not** in the middleware matcher (they stay public by omission). Comment at top of middleware still lists them as public routes conceptually.

**`lib/supabase/middleware.ts`:** exports `updateSession()` which creates a Supabase SSR client and calls `getUser()` to refresh cookies. **Root `middleware.ts` does not import or call it**; teacher protection inlines its own `createServerClient` cookie handling instead.

### Evidence

**`requireStudentApi` / `requireProfessorApi`:**

```22:63:lib/api-auth.ts
export async function requireProfessorApi(): Promise<ProfessorAuthResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  ...
  if (profile?.role !== "teacher") {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, professorId: user.id };
}

export async function requireStudentApi(): Promise<StudentAuthResult> {
  const session = await getStudentSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true, session };
}
```

**`requireRole`:**

```30:36:lib/auth-helpers.ts
export async function requireRole(role: UserRole): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== role) {
    redirect(profile.role === "teacher" ? "/teacher/dashboard" : "/student/dashboard");
  }
  return profile;
}
```

**Middleware student + teacher gates + matcher:**

```22:72:middleware.ts
  if (pathname.startsWith("/student/")) {
    const token = request.cookies.get(STUDENT_SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/student-login", request.url));
    }
    const session = await verifyStudentSessionToken(token);
    if (!session) {
      return NextResponse.redirect(new URL("/student-login", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/teacher/")) {
    ...
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
```

```121:123:middleware.ts
export const config = {
  matcher: ["/teacher/:path*", "/student/:path*", "/login", "/register"],
};
```

**Student layout secondary check:** `app/student/layout.tsx` lines 21–24.

**Unused-by-root helper:** `lib/supabase/middleware.ts` lines 12–40 (`updateSession`).

---

## 7. Cross-References (links to the six page routes)

Every codebase reference found that links, redirects, pushes, or defines the path for these routes. Line numbers are as of this audit.

### `/login`

| File | Line(s) | How referenced |
|------|---------|----------------|
| `lib/constants.ts` | 115 | In `PUBLIC_ROUTES` |
| `middleware.ts` | 41, 67–69, 104, 122 | Redirect target; auth-page redirect-away; matcher |
| `lib/auth-helpers.ts` | 32 | `redirect("/login")` when no profile |
| `app/page.tsx` | 22 | `redirect("/login")` when no profile (and no student session) |
| `app/(auth)/register/page.tsx` | 116 | `<Link href="/login">` |
| `components/AppHeader.tsx` | 44 | `router.push("/login")` after professor logout |
| `components/shared/Sidebar.tsx` | 256 | `router.push("/login")` after professor logout |

### `/register`

| File | Line(s) | How referenced |
|------|---------|----------------|
| `lib/constants.ts` | 116 | In `PUBLIC_ROUTES` |
| `middleware.ts` | 104, 122 | Redirect authenticated teachers away; matcher |
| `app/(auth)/login/LoginForm.tsx` | 119 | `<Link href="/register">` |

### `/student-login`

| File | Line(s) | How referenced |
|------|---------|----------------|
| `lib/constants.ts` | 117 | In `PUBLIC_ROUTES` |
| `middleware.ts` | 6 (comment), 25, 29 | Unauthenticated `/student/*` redirect |
| `app/(auth)/login/page.tsx` | 51 | `<Link href="/student-login">` |
| `app/join/page.tsx` | 26 | `<Link href="/student-login">` |
| `app/join/[joinCode]/page.tsx` | 106 | `<Link href="/student-login">` |
| `app/student-register/page.tsx` | 56 | `<Link href="/student-login">` |
| `app/student-register/StudentRegisterForm.tsx` | 133 | `<Link href="/student-login">` |
| `app/student/layout.tsx` | 23 | `redirect("/student-login")` |
| `app/student/dashboard/page.tsx` | 29 | `redirect("/student-login")` |
| `app/student/classes/[classId]/page.tsx` | 34 | `redirect("/student-login")` |
| `app/student/simulation/[id]/page.tsx` | 38 | `redirect("/student-login")` |
| `app/student/simulation/[id]/entry/page.tsx` | 50 | `redirect("/student-login")` |
| `app/student/simulation/[id]/complete/page.tsx` | 66 | `redirect("/student-login")` |
| `components/AppHeader.tsx` | 37 | `router.push("/student-login")` after student logout |
| `components/student/StudentDashboardHeader.tsx` | 30 | `router.push("/student-login")` after logout |

### `/student-register`

| File | Line(s) | How referenced |
|------|---------|----------------|
| `lib/constants.ts` | 118 | In `PUBLIC_ROUTES` |
| `middleware.ts` | 6 (comment) | Listed as public |
| `app/join/page.tsx` | 23 | `<Link href="/student-register">` |
| `app/join/[joinCode]/page.tsx` | 21, 88 | Builds `/student-register?code=…`; Register CTA |

### `/join`

| File | Line(s) | How referenced |
|------|---------|----------------|
| `lib/constants.ts` | 119, 123 | `PUBLIC_ROUTES`; `STUDENT_JOIN_PATH = "/join"` |
| `middleware.ts` | 6 (comment) | Listed as public (`/join/*`) |
| `app/student-login/StudentLoginForm.tsx` | 77 | `<Link href="/join">` |
| `components/TeacherClassesSection.tsx` | 13, 81–85 | Builds share URL from `STUDENT_JOIN_PATH` |
| `components/ClassManagementClient.tsx` | 11, 48–51, 62–64 | Copy join link = origin + `/join` |
| `components/shared/Sidebar.tsx` | 30, 401–403, 827–830, 2056–2057 | Same join URL helper / copy link |

### `/join/[joinCode]` (dynamic)

| File | Line(s) | How referenced |
|------|---------|----------------|
| `app/join/[joinCode]/page.tsx` | (route itself) | Implements the page |
| *(no other file found constructing `/join/${code}` links)* | — | Professor UIs share `/join` + separate code; this route is only reached by typing/sharing a URL that includes the code segment |

Related but **not** linking to these pages: `app/student/dashboard/JoinClassButton.tsx` posts to `/api/student/join-class` (enrollment for logged-in students).

---

## Findings Relevant to Consolidation

Observations only (no recommendation):

1. **Two parallel identity systems exist.** Professors use Supabase Auth + `profiles`. Class students use custom `students` rows + JWT cookie `student_session`. They do not share the same login surface or credential store.

2. **`/register` (Supabase) still offers a “student” role card.** That path creates `auth.users` + `profiles` with role `student`, not a `students` table account. The JWT student portal (`/student/*`) expects `student_session`, not that profile. Consolidating “student signup” would need to account for this second, older-style student creation path.

3. **Class code is required for JWT student registration** (form + API). There is no code-optional register path in the current student-register API.

4. **`/join` vs `/join/[joinCode]`.**  
   - `/join` is the **professor-shared link** today (`STUDENT_JOIN_PATH`). Code is shared separately; enrollment happens at register or via dashboard Join Class.  
   - `/join/[joinCode]` is a **code-prefilled invite landing** that only deep-links to `/student-register?code=…` for new users; it does not enroll returning users. Consolidating it into signup would require deciding what happens to that deep-link URL shape and to returning users who land on it (today: Sign In → dashboard → manual Join Class).

5. **Additional-class join for existing students is not on the join pages.** It is `JoinClassButton` → `POST /api/student/join-class`. Any consolidation of join/signup UI must keep or relocate that authenticated enrollment path.

6. **Registration also auto-enrolls every new student in the system default class** (`enrollStudentInDefaultClass` / `DEFAULT_CLASS_ID`), in addition to the professor class from the join code.

7. **Middleware matcher does not include** `/student-login`, `/student-register`, or `/join*`. Protection for student app routes is `/student/*` + layout checks. Renaming those public entry routes would mainly touch redirects/links listed in section 7, not the matcher (unless they become protected).

8. **Professor unauthenticated access** to `/teacher/*` redirects to `/login?redirect=…`. Student unauthenticated access to `/student/*` redirects to `/student-login` (no redirect-back query param in middleware).

9. **Logout targets differ:** student logout → `/student-login`; professor Supabase logout → `/login` (`AppHeader`, `Sidebar`).

10. **`lib/supabase/middleware.ts` `updateSession` is not wired into root `middleware.ts`.** Session refresh for teachers is inlined in the root middleware’s `/teacher/*` branch instead.

11. **Cross-link surface area for rename/consolidation** is largest for `/student-login` (many redirects). `/join/[joinCode]` has almost no inbound link generators in-repo; `/register` has few inbound links beyond professor login.
