// Built by scripts/build.mjs from assets/*.js. Do not edit; run `npm run build`.
(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // node_modules/gotrue-js/lib/index.js
  var HTTPError = class extends Error {
    constructor(response) {
      super(response.statusText);
      this.name = "HTTPError";
      this.status = response.status;
    }
  };
  var TextHTTPError = class extends HTTPError {
    constructor(response, data) {
      super(response);
      this.name = "TextHTTPError";
      this.data = data;
    }
  };
  var JSONHTTPError = class extends HTTPError {
    constructor(response, json) {
      super(response);
      this.name = "JSONHTTPError";
      this.json = json;
    }
  };
  var API = class _API {
    constructor(apiURL, options) {
      this.apiURL = apiURL || "";
      this._sameOrigin = /^\/(?!\/)/.test(this.apiURL);
      this.defaultHeaders = options?.defaultHeaders || {};
    }
    headers(headers = {}) {
      return {
        ...this.defaultHeaders,
        "Content-Type": "application/json",
        ...headers
      };
    }
    static async parseJsonResponse(response) {
      const json = await response.json();
      if (!response.ok) {
        throw new JSONHTTPError(response, json);
      }
      return json;
    }
    async request(path, options = {}) {
      const headers = this.headers(options.headers || {});
      if (!options.body) {
        delete headers["Content-Type"];
      }
      const fetchOptions = {
        ...options,
        headers
      };
      if (this._sameOrigin) {
        fetchOptions.credentials = options.credentials || "same-origin";
      }
      const response = await fetch(this.apiURL + path, fetchOptions);
      const contentType = response.headers.get("Content-Type");
      if (contentType?.includes("json")) {
        return _API.parseJsonResponse(response);
      }
      const data = await response.text();
      if (!response.ok) {
        throw new TextHTTPError(response, data);
      }
      return data;
    }
  };
  var Admin = class {
    constructor(user) {
      this.user = user;
    }
    listUsers(aud) {
      return this.user._request("/admin/users", {
        method: "GET",
        audience: aud
      });
    }
    getUser(user) {
      return this.user._request(`/admin/users/${user.id}`);
    }
    updateUser(user, attributes = {}) {
      return this.user._request(`/admin/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify(attributes)
      });
    }
    createUser(email, password, attributes = {}) {
      attributes.email = email;
      attributes.password = password;
      return this.user._request("/admin/users", {
        method: "POST",
        body: JSON.stringify(attributes)
      });
    }
    deleteUser(user) {
      return this.user._request(`/admin/users/${user.id}`, {
        method: "DELETE"
      });
    }
  };
  var ExpiryMargin = 60 * 1e3;
  var storageKey = "gotrue.user";
  var refreshPromises = {};
  var currentUser = null;
  var forbiddenUpdateAttributes = { api: 1, token: 1, audience: 1, url: 1 };
  var forbiddenSaveAttributes = { api: 1 };
  var isBrowser = () => typeof window !== "undefined";
  var storageListenerActive = false;
  function ensureStorageListener() {
    if (!storageListenerActive && isBrowser()) {
      storageListenerActive = true;
      window.addEventListener("storage", (event) => {
        if (event.key === storageKey) {
          currentUser = null;
        }
      });
    }
  }
  var User = class _User {
    constructor(api, tokenResponse, audience) {
      this.token = null;
      this.api = api;
      this.url = api.apiURL;
      this.audience = audience;
      this._processTokenResponse(tokenResponse);
      currentUser = this;
      ensureStorageListener();
    }
    static removeSavedSession() {
      isBrowser() && localStorage.removeItem(storageKey);
    }
    static recoverSession(apiInstance) {
      ensureStorageListener();
      if (currentUser) {
        return currentUser;
      }
      const json = isBrowser() && localStorage.getItem(storageKey);
      if (json) {
        try {
          const data = JSON.parse(json);
          const { url, token, audience } = data;
          if (!url || !token) {
            return null;
          }
          const api = apiInstance || new API(url, {});
          return new _User(api, token, audience)._saveUserData(data, true);
        } catch (error) {
          console.error(new Error(`Gotrue-js: Error recovering session: ${error}`));
          return null;
        }
      }
      return null;
    }
    get admin() {
      return new Admin(this);
    }
    async update(attributes) {
      const response = await this._request("/user", {
        method: "PUT",
        body: JSON.stringify(attributes)
      });
      return this._saveUserData(response)._refreshSavedSession();
    }
    jwt(forceRefresh) {
      const token = this.tokenDetails();
      if (token === null || token === void 0) {
        return Promise.reject(new Error(`Gotrue-js: failed getting jwt access token`));
      }
      const { expires_at, refresh_token, access_token } = token;
      if (forceRefresh || expires_at - ExpiryMargin < Date.now()) {
        return this._refreshToken(refresh_token);
      }
      return Promise.resolve(access_token);
    }
    logout() {
      return this._request("/logout", { method: "POST" }).then(this.clearSession.bind(this)).catch(this.clearSession.bind(this));
    }
    _refreshToken(refresh_token) {
      const existingPromise = refreshPromises[refresh_token];
      if (existingPromise) {
        return existingPromise;
      }
      const refreshRequest = this.api.request("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${refresh_token}`
      });
      const timeoutPromise = new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("Token refresh timeout")), 3e4);
      });
      const promise = Promise.race([refreshRequest, timeoutPromise]).then((response) => {
        delete refreshPromises[refresh_token];
        this._processTokenResponse(response);
        this._refreshSavedSession();
        if (!this.token) {
          throw new Error("Gotrue-js: Token not set after refresh");
        }
        return this.token.access_token;
      }).catch((error) => {
        delete refreshPromises[refresh_token];
        this.clearSession();
        throw error;
      });
      refreshPromises[refresh_token] = promise;
      return promise;
    }
    async _request(path, options = {}) {
      options.headers = options.headers || {};
      const aud = options.audience || this.audience;
      if (aud) {
        options.headers["X-JWT-AUD"] = aud;
      }
      try {
        const token = await this.jwt();
        return await this.api.request(path, {
          headers: Object.assign(options.headers, {
            Authorization: `Bearer ${token}`
          }),
          ...options
        });
      } catch (error) {
        if (error instanceof JSONHTTPError && error.json) {
          if (error.json.msg) {
            error.message = error.json.msg;
          } else if (error.json.error) {
            error.message = `${error.json.error}: ${error.json.error_description}`;
          }
        }
        throw error;
      }
    }
    async getUserData() {
      const response = await this._request("/user");
      return this._saveUserData(response)._refreshSavedSession();
    }
    _saveUserData(attributes, fromStorage) {
      for (const key in attributes) {
        if (key in _User.prototype || key in forbiddenUpdateAttributes) {
          continue;
        }
        this[key] = attributes[key];
      }
      if (fromStorage) {
        this._fromStorage = true;
      }
      return this;
    }
    _processTokenResponse(tokenResponse) {
      this.token = tokenResponse;
      try {
        const claims = JSON.parse(urlBase64Decode(tokenResponse.access_token.split(".")[1]));
        this.token.expires_at = claims.exp * 1e3;
      } catch (error) {
        console.error(new Error(`Gotrue-js: Failed to parse tokenResponse claims: ${error}`));
      }
    }
    _refreshSavedSession() {
      if (isBrowser() && localStorage.getItem(storageKey)) {
        this._saveSession();
      }
      return this;
    }
    get _details() {
      const userCopy = {};
      for (const key in this) {
        if (key in _User.prototype || key in forbiddenSaveAttributes) {
          continue;
        }
        userCopy[key] = this[key];
      }
      return userCopy;
    }
    _saveSession() {
      isBrowser() && localStorage.setItem(storageKey, JSON.stringify(this._details));
      return this;
    }
    tokenDetails() {
      return this.token;
    }
    clearSession() {
      _User.removeSavedSession();
      this.token = null;
      currentUser = null;
    }
  };
  function base64Decode(base64) {
    if (typeof atob === "function") {
      return atob(base64);
    }
    return Buffer.from(base64, "base64").toString("binary");
  }
  function urlBase64Decode(str) {
    let output = str.replace(/-/g, "+").replace(/_/g, "/");
    switch (output.length % 4) {
      case 0:
        break;
      case 2:
        output += "==";
        break;
      case 3:
        output += "=";
        break;
      default:
        throw new Error("Illegal base64url string!");
    }
    const binaryString = base64Decode(output);
    try {
      const bytes = Uint8Array.from(binaryString, (char) => char.codePointAt(0) ?? 0);
      return new TextDecoder().decode(bytes);
    } catch {
      return binaryString;
    }
  }
  var HTTPRegexp = /^http:\/\//;
  var defaultApiURL = `/.netlify/identity`;
  var GoTrue = class {
    constructor({
      APIUrl = defaultApiURL,
      audience = "",
      setCookie = false,
      clientName = "gotrue-js"
    } = {}) {
      if (HTTPRegexp.test(APIUrl)) {
        console.warn(
          "Warning:\n\nDO NOT USE HTTP IN PRODUCTION FOR GOTRUE EVER!\nGoTrue REQUIRES HTTPS to work securely."
        );
      }
      if (audience) {
        this.audience = audience;
      }
      this.setCookie = setCookie;
      this.api = new API(APIUrl, { defaultHeaders: { "X-Nf-Client": clientName } });
    }
    async _request(path, options = {}) {
      options.headers = options.headers || {};
      const aud = options.audience || this.audience;
      if (aud) {
        options.headers["X-JWT-AUD"] = aud;
      }
      try {
        return await this.api.request(path, options);
      } catch (error) {
        if (error instanceof JSONHTTPError && error.json) {
          if (error.json.msg) {
            error.message = error.json.msg;
          } else if (error.json.error) {
            error.message = `${error.json.error}: ${error.json.error_description}`;
          }
        }
        throw error;
      }
    }
    settings() {
      return this._request("/settings");
    }
    signup(email, password, data) {
      return this._request("/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, data })
      });
    }
    login(email, password, remember) {
      this._setRememberHeaders(remember);
      return this._request("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=password&username=${encodeURIComponent(
          email
        )}&password=${encodeURIComponent(password)}`
      }).then((response) => {
        User.removeSavedSession();
        return this.createUser(response, remember);
      });
    }
    loginExternalUrl(provider) {
      return `${this.api.apiURL}/authorize?provider=${provider}`;
    }
    confirm(token, remember) {
      this._setRememberHeaders(remember);
      return this.verify("signup", token, remember);
    }
    requestPasswordRecovery(email) {
      return this._request("/recover", {
        method: "POST",
        body: JSON.stringify({ email })
      });
    }
    recover(token, remember) {
      this._setRememberHeaders(remember);
      return this.verify("recovery", token, remember);
    }
    acceptInvite(token, password, remember) {
      this._setRememberHeaders(remember);
      return this._request("/verify", {
        method: "POST",
        body: JSON.stringify({ token, password, type: "signup" })
      }).then((response) => this.createUser(response, remember));
    }
    acceptInviteExternalUrl(provider, token) {
      return `${this.api.apiURL}/authorize?provider=${provider}&invite_token=${token}`;
    }
    createUser(tokenResponse, remember = false) {
      this._setRememberHeaders(remember);
      const user = new User(this.api, tokenResponse, this.audience || "");
      return user.getUserData().then((userData) => {
        if (remember) {
          userData._saveSession();
        }
        return userData;
      });
    }
    currentUser() {
      const user = User.recoverSession(this.api);
      user && this._setRememberHeaders(user._fromStorage);
      return user;
    }
    async validateCurrentSession() {
      const user = this.currentUser();
      if (!user) {
        return null;
      }
      try {
        return await user.getUserData();
      } catch {
        user.clearSession();
        return null;
      }
    }
    verify(type, token, remember) {
      this._setRememberHeaders(remember);
      return this._request("/verify", {
        method: "POST",
        body: JSON.stringify({ token, type })
      }).then((response) => this.createUser(response, remember));
    }
    _setRememberHeaders(remember) {
      if (this.setCookie) {
        this.api.defaultHeaders = this.api.defaultHeaders || {};
        this.api.defaultHeaders["X-Use-Cookie"] = remember ? "1" : "session";
      }
    }
  };
  if (typeof window !== "undefined") {
    window.GoTrue = GoTrue;
  }

  // node_modules/@netlify/identity/dist/main.js
  var __require2 = /* @__PURE__ */ ((x) => typeof __require !== "undefined" ? __require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof __require !== "undefined" ? __require : a)[b]
  }) : x)(function(x) {
    if (typeof __require !== "undefined") return __require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var AUTH_PROVIDERS = ["google", "github", "gitlab", "bitbucket", "facebook", "email"];
  var AuthError = class _AuthError extends Error {
    constructor(message, status, options) {
      super(message);
      this.name = "AuthError";
      this.status = status;
      if (options && "cause" in options) {
        this.cause = options.cause;
      }
    }
    static from(error) {
      if (error instanceof _AuthError) return error;
      const message = error instanceof Error ? error.message : String(error);
      return new _AuthError(message, void 0, { cause: error });
    }
  };
  var MissingIdentityError = class extends Error {
    constructor(message = "Netlify Identity is not available.") {
      super(message);
      this.name = "MissingIdentityError";
    }
  };
  var IDENTITY_PATH = "/.netlify/identity";
  var goTrueClient = null;
  var cachedApiUrl;
  var warnedMissingUrl = false;
  var isBrowser2 = () => typeof window !== "undefined" && typeof window.location !== "undefined";
  var discoverApiUrl = () => {
    if (cachedApiUrl !== void 0) return cachedApiUrl;
    if (isBrowser2()) {
      cachedApiUrl = `${window.location.origin}${IDENTITY_PATH}`;
    } else {
      const identityContext = getIdentityContext();
      if (identityContext?.url) {
        cachedApiUrl = identityContext.url;
      } else if (globalThis.Netlify?.context?.url) {
        cachedApiUrl = new URL(IDENTITY_PATH, globalThis.Netlify.context.url).href;
      } else if (typeof process !== "undefined" && process.env?.URL) {
        cachedApiUrl = new URL(IDENTITY_PATH, process.env.URL).href;
      }
    }
    return cachedApiUrl ?? null;
  };
  var getGoTrueClient = () => {
    if (goTrueClient) return goTrueClient;
    const apiUrl = discoverApiUrl();
    if (!apiUrl) {
      if (!warnedMissingUrl) {
        console.warn(
          "@netlify/identity: Could not determine the Identity endpoint URL. Make sure your site has Netlify Identity enabled, or run your app with `netlify dev`."
        );
        warnedMissingUrl = true;
      }
      return null;
    }
    goTrueClient = new GoTrue({ APIUrl: apiUrl, setCookie: false });
    return goTrueClient;
  };
  var getClient = () => {
    const client = getGoTrueClient();
    if (!client) throw new MissingIdentityError();
    return client;
  };
  var getIdentityContext = () => {
    const identityContext = globalThis.netlifyIdentityContext;
    if (identityContext?.url) {
      return {
        url: identityContext.url,
        token: identityContext.token
      };
    }
    if (globalThis.Netlify?.context?.url) {
      return { url: new URL(IDENTITY_PATH, globalThis.Netlify.context.url).href };
    }
    const siteUrl = typeof process !== "undefined" ? process.env?.URL : void 0;
    if (siteUrl) {
      return { url: new URL(IDENTITY_PATH, siteUrl).href };
    }
    return null;
  };
  var NF_JWT_COOKIE = "nf_jwt";
  var NF_REFRESH_COOKIE = "nf_refresh";
  var getCookie = (name) => {
    if (typeof document === "undefined") return null;
    const match = new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`).exec(document.cookie);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  };
  var setAuthCookies = (cookies, accessToken, refreshToken) => {
    cookies.set({
      name: NF_JWT_COOKIE,
      value: accessToken,
      httpOnly: false,
      secure: true,
      path: "/",
      sameSite: "Lax"
    });
    if (refreshToken) {
      cookies.set({
        name: NF_REFRESH_COOKIE,
        value: refreshToken,
        httpOnly: false,
        secure: true,
        path: "/",
        sameSite: "Lax"
      });
    }
  };
  var deleteAuthCookies = (cookies) => {
    cookies.delete(NF_JWT_COOKIE);
    cookies.delete(NF_REFRESH_COOKIE);
  };
  var setBrowserAuthCookies = (accessToken, refreshToken) => {
    if (typeof document === "undefined") return;
    document.cookie = `${NF_JWT_COOKIE}=${encodeURIComponent(accessToken)}; path=/; secure; samesite=lax`;
    if (refreshToken) {
      document.cookie = `${NF_REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; path=/; secure; samesite=lax`;
    }
  };
  var deleteBrowserAuthCookies = () => {
    if (typeof document === "undefined") return;
    document.cookie = `${NF_JWT_COOKIE}=; path=/; secure; samesite=lax; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    document.cookie = `${NF_REFRESH_COOKIE}=; path=/; secure; samesite=lax; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  };
  var getServerCookie = (name) => {
    const cookies = globalThis.Netlify?.context?.cookies;
    if (!cookies || typeof cookies.get !== "function") return null;
    return cookies.get(name) ?? null;
  };
  var nextHeadersFn;
  var triggerNextjsDynamic = () => {
    if (nextHeadersFn === null) return;
    if (nextHeadersFn === void 0) {
      try {
        if (typeof __require2 === "undefined") {
          nextHeadersFn = null;
          return;
        }
        const mod = __require2("next/headers");
        nextHeadersFn = mod.headers;
      } catch {
        nextHeadersFn = null;
        return;
      }
    }
    const fn = nextHeadersFn;
    if (!fn) return;
    try {
      fn();
    } catch (e) {
      if (e instanceof Error && ("digest" in e || /bail\s*out.*prerende/i.test(e.message))) {
        throw e;
      }
    }
  };
  var DEFAULT_TIMEOUT_MS = 5e3;
  var fetchWithTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const pathname = new URL(url).pathname;
        throw new AuthError(`Identity request to ${pathname} timed out after ${String(timeoutMs)}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  var AUTH_EVENTS = {
    LOGIN: "login",
    LOGOUT: "logout",
    TOKEN_REFRESH: "token_refresh",
    USER_UPDATED: "user_updated",
    RECOVERY: "recovery"
  };
  var GOTRUE_STORAGE_KEY = "gotrue.user";
  var listeners = /* @__PURE__ */ new Set();
  var emitAuthEvent = (event, user) => {
    for (const listener of listeners) {
      try {
        listener(event, user);
      } catch {
      }
    }
  };
  var storageListenerAttached = false;
  var attachStorageListener = () => {
    if (storageListenerAttached || !isBrowser2()) return;
    storageListenerAttached = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== GOTRUE_STORAGE_KEY) return;
      if (event.newValue) {
        const client = getGoTrueClient();
        const currentUser3 = client?.currentUser();
        emitAuthEvent(AUTH_EVENTS.LOGIN, currentUser3 ? toUser(currentUser3) : null);
      } else {
        emitAuthEvent(AUTH_EVENTS.LOGOUT, null);
      }
    });
  };
  var onAuthChange = (callback) => {
    if (!isBrowser2()) {
      return () => {
      };
    }
    listeners.add(callback);
    attachStorageListener();
    return () => {
      listeners.delete(callback);
    };
  };
  var REFRESH_MARGIN_S = 60;
  var refreshTimer = null;
  var startTokenRefresh = () => {
    if (!isBrowser2()) return;
    stopTokenRefresh();
    const client = getGoTrueClient();
    const user = client?.currentUser();
    if (!user) return;
    const token = user.tokenDetails();
    if (!token?.expires_at) return;
    const nowS = Math.floor(Date.now() / 1e3);
    const expiresAtS = typeof token.expires_at === "number" && token.expires_at > 1e12 ? Math.floor(token.expires_at / 1e3) : token.expires_at;
    const delayMs = Math.max(0, expiresAtS - nowS - REFRESH_MARGIN_S) * 1e3;
    refreshTimer = setTimeout(() => {
      void (async () => {
        try {
          const freshJwt = await user.jwt(true);
          const freshDetails = user.tokenDetails();
          setBrowserAuthCookies(freshJwt, freshDetails?.refresh_token);
          emitAuthEvent(AUTH_EVENTS.TOKEN_REFRESH, toUser(user));
          startTokenRefresh();
        } catch {
          stopTokenRefresh();
        }
      })();
    }, delayMs);
  };
  var stopTokenRefresh = () => {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };
  var refreshSession = async () => {
    if (isBrowser2()) {
      const client = getGoTrueClient();
      const user = client?.currentUser();
      if (!user) return null;
      const details = user.tokenDetails();
      if (details?.expires_at) {
        const nowS2 = Math.floor(Date.now() / 1e3);
        const expiresAtS = typeof details.expires_at === "number" && details.expires_at > 1e12 ? Math.floor(details.expires_at / 1e3) : details.expires_at;
        if (expiresAtS - nowS2 > REFRESH_MARGIN_S) {
          return null;
        }
      }
      try {
        const jwt = await user.jwt(true);
        setBrowserAuthCookies(jwt, user.tokenDetails()?.refresh_token);
        emitAuthEvent(AUTH_EVENTS.TOKEN_REFRESH, toUser(user));
        startTokenRefresh();
        return jwt;
      } catch {
        stopTokenRefresh();
        return null;
      }
    }
    const accessToken = getServerCookie(NF_JWT_COOKIE);
    const refreshToken = getServerCookie(NF_REFRESH_COOKIE);
    if (!accessToken || !refreshToken) return null;
    const decoded = decodeJwtPayload(accessToken);
    if (!decoded?.exp) return null;
    const nowS = Math.floor(Date.now() / 1e3);
    if (decoded.exp - nowS > REFRESH_MARGIN_S) {
      return null;
    }
    const ctx = getIdentityContext();
    const identityUrl = ctx?.url ?? (globalThis.Netlify?.context?.url ? new URL(IDENTITY_PATH, globalThis.Netlify.context.url).href : null);
    if (!identityUrl) {
      throw new AuthError("Could not determine the Identity endpoint URL for token refresh");
    }
    let res;
    try {
      res = await fetchWithTimeout(`${identityUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString()
      });
    } catch (error) {
      throw AuthError.from(error);
    }
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 400) {
        const cookies2 = globalThis.Netlify?.context?.cookies;
        if (cookies2) {
          deleteAuthCookies(cookies2);
        }
        return null;
      }
      throw new AuthError(errorBody.msg ?? `Token refresh failed (${String(res.status)})`, res.status);
    }
    const data = await res.json();
    const cookies = globalThis.Netlify?.context?.cookies;
    if (cookies) {
      setAuthCookies(cookies, data.access_token, data.refresh_token);
    }
    return data.access_token;
  };
  var getCookies = () => {
    const cookies = globalThis.Netlify?.context?.cookies;
    if (!cookies) {
      throw new AuthError("Server-side auth requires Netlify Functions runtime");
    }
    return cookies;
  };
  var getServerIdentityUrl = () => {
    const ctx = getIdentityContext();
    if (!ctx?.url) {
      throw new AuthError("Could not determine the Identity endpoint URL on the server");
    }
    return ctx.url;
  };
  var persistSession = true;
  var login = async (email, password) => {
    if (!isBrowser2()) {
      const identityUrl = getServerIdentityUrl();
      const cookies = getCookies();
      const body = new URLSearchParams({
        grant_type: "password",
        username: email,
        password
      });
      let res;
      try {
        res = await fetchWithTimeout(`${identityUrl}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString()
        });
      } catch (error) {
        throw AuthError.from(error);
      }
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new AuthError(
          errorBody.msg ?? errorBody.error_description ?? `Login failed (${String(res.status)})`,
          res.status
        );
      }
      const data = await res.json();
      const accessToken = data.access_token;
      let userRes;
      try {
        userRes = await fetchWithTimeout(`${identityUrl}/user`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      } catch (error) {
        throw AuthError.from(error);
      }
      if (!userRes.ok) {
        const errorBody = await userRes.json().catch(() => ({}));
        throw new AuthError(errorBody.msg ?? `Failed to fetch user data (${String(userRes.status)})`, userRes.status);
      }
      const userData = await userRes.json();
      const user = toUser(userData);
      setAuthCookies(cookies, accessToken, data.refresh_token);
      return user;
    }
    const client = getClient();
    try {
      const gotrueUser = await client.login(email, password, persistSession);
      const jwt = await gotrueUser.jwt();
      setBrowserAuthCookies(jwt, gotrueUser.tokenDetails()?.refresh_token);
      const user = toUser(gotrueUser);
      startTokenRefresh();
      emitAuthEvent(AUTH_EVENTS.LOGIN, user);
      return user;
    } catch (error) {
      throw AuthError.from(error);
    }
  };
  var signup = async (email, password, data) => {
    if (!isBrowser2()) {
      const identityUrl = getServerIdentityUrl();
      const cookies = getCookies();
      let res;
      try {
        res = await fetchWithTimeout(`${identityUrl}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, data })
        });
      } catch (error) {
        throw AuthError.from(error);
      }
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new AuthError(errorBody.msg ?? `Signup failed (${String(res.status)})`, res.status);
      }
      const responseData = await res.json();
      const user = toUser(responseData);
      if (responseData.confirmed_at) {
        const accessToken = responseData.access_token;
        if (accessToken) {
          setAuthCookies(cookies, accessToken, responseData.refresh_token);
        }
      }
      return user;
    }
    const client = getClient();
    try {
      const response = await client.signup(email, password, data);
      const user = toUser(response);
      if (response.confirmed_at) {
        const jwt = await response.jwt?.();
        if (jwt) {
          const refreshToken = response.tokenDetails?.()?.refresh_token;
          setBrowserAuthCookies(jwt, refreshToken);
        }
        startTokenRefresh();
        emitAuthEvent(AUTH_EVENTS.LOGIN, user);
      }
      return user;
    } catch (error) {
      throw AuthError.from(error);
    }
  };
  var logout = async () => {
    if (!isBrowser2()) {
      const identityUrl = getServerIdentityUrl();
      const cookies = getCookies();
      const jwt = cookies.get(NF_JWT_COOKIE);
      if (jwt) {
        try {
          await fetchWithTimeout(`${identityUrl}/logout`, {
            method: "POST",
            headers: { Authorization: `Bearer ${jwt}` }
          });
        } catch {
        }
      }
      deleteAuthCookies(cookies);
      return;
    }
    const client = getClient();
    try {
      const currentUser3 = client.currentUser();
      if (currentUser3) {
        await currentUser3.logout();
      }
      deleteBrowserAuthCookies();
      stopTokenRefresh();
      emitAuthEvent(AUTH_EVENTS.LOGOUT, null);
    } catch (error) {
      throw AuthError.from(error);
    }
  };
  var handleAuthCallback = async () => {
    if (!isBrowser2()) return null;
    const hash = window.location.hash.substring(1);
    if (!hash) return null;
    const client = getClient();
    const params2 = new URLSearchParams(hash);
    try {
      const accessToken = params2.get("access_token");
      if (accessToken) return await handleOAuthCallback(client, params2, accessToken);
      const confirmationToken = params2.get("confirmation_token");
      if (confirmationToken) return await handleConfirmationCallback(client, confirmationToken);
      const recoveryToken = params2.get("recovery_token");
      if (recoveryToken) return await handleRecoveryCallback(client, recoveryToken);
      const inviteToken2 = params2.get("invite_token");
      if (inviteToken2) return handleInviteCallback(inviteToken2);
      const emailChangeToken = params2.get("email_change_token");
      if (emailChangeToken) return await handleEmailChangeCallback(client, emailChangeToken);
      return null;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw AuthError.from(error);
    }
  };
  var handleOAuthCallback = async (client, params2, accessToken) => {
    const refreshToken = params2.get("refresh_token") ?? "";
    const expiresIn = parseInt(params2.get("expires_in") ?? "", 10);
    const expiresAt = parseInt(params2.get("expires_at") ?? "", 10);
    const gotrueUser = await client.createUser(
      {
        access_token: accessToken,
        token_type: params2.get("token_type") ?? "bearer",
        expires_in: isFinite(expiresIn) ? expiresIn : 3600,
        expires_at: isFinite(expiresAt) ? expiresAt : Math.floor(Date.now() / 1e3) + 3600,
        refresh_token: refreshToken
      },
      persistSession
    );
    setBrowserAuthCookies(accessToken, refreshToken || void 0);
    const user = toUser(gotrueUser);
    startTokenRefresh();
    clearHash();
    emitAuthEvent(AUTH_EVENTS.LOGIN, user);
    return { type: "oauth", user };
  };
  var handleConfirmationCallback = async (client, token) => {
    const gotrueUser = await client.confirm(token, persistSession);
    const jwt = await gotrueUser.jwt();
    setBrowserAuthCookies(jwt, gotrueUser.tokenDetails()?.refresh_token);
    const user = toUser(gotrueUser);
    startTokenRefresh();
    clearHash();
    emitAuthEvent(AUTH_EVENTS.LOGIN, user);
    return { type: "confirmation", user };
  };
  var handleRecoveryCallback = async (client, token) => {
    const gotrueUser = await client.recover(token, persistSession);
    const jwt = await gotrueUser.jwt();
    setBrowserAuthCookies(jwt, gotrueUser.tokenDetails()?.refresh_token);
    const user = toUser(gotrueUser);
    startTokenRefresh();
    clearHash();
    emitAuthEvent(AUTH_EVENTS.RECOVERY, user);
    return { type: "recovery", user };
  };
  var handleInviteCallback = (token) => {
    clearHash();
    return { type: "invite", user: null, token };
  };
  var handleEmailChangeCallback = async (client, emailChangeToken) => {
    const currentUser3 = client.currentUser();
    if (!currentUser3) {
      throw new AuthError("Email change verification requires an active browser session");
    }
    const jwt = await currentUser3.jwt();
    const identityUrl = `${window.location.origin}${IDENTITY_PATH}`;
    const emailChangeRes = await fetch(`${identityUrl}/user`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({ email_change_token: emailChangeToken })
    });
    if (!emailChangeRes.ok) {
      const errorBody = await emailChangeRes.json().catch(() => ({}));
      throw new AuthError(
        errorBody.msg ?? `Email change verification failed (${String(emailChangeRes.status)})`,
        emailChangeRes.status
      );
    }
    const emailChangeData = await emailChangeRes.json();
    const user = toUser(emailChangeData);
    clearHash();
    emitAuthEvent(AUTH_EVENTS.USER_UPDATED, user);
    return { type: "email_change", user };
  };
  var clearHash = () => {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  var hydrateSession = async () => {
    if (!isBrowser2()) return null;
    const client = getClient();
    const currentUser3 = client.currentUser();
    if (currentUser3) {
      startTokenRefresh();
      return toUser(currentUser3);
    }
    const accessToken = getCookie(NF_JWT_COOKIE);
    if (!accessToken) return null;
    const refreshToken = getCookie(NF_REFRESH_COOKIE) ?? "";
    const decoded = decodeJwtPayload(accessToken);
    const expiresAt = decoded?.exp ?? Math.floor(Date.now() / 1e3) + 3600;
    const expiresIn = Math.max(0, expiresAt - Math.floor(Date.now() / 1e3));
    let gotrueUser;
    try {
      gotrueUser = await client.createUser(
        {
          access_token: accessToken,
          token_type: "bearer",
          expires_in: expiresIn,
          expires_at: expiresAt,
          refresh_token: refreshToken
        },
        persistSession
      );
    } catch {
      deleteBrowserAuthCookies();
      return null;
    }
    const user = toUser(gotrueUser);
    startTokenRefresh();
    emitAuthEvent(AUTH_EVENTS.LOGIN, user);
    return user;
  };
  var toAuthProvider = (value) => typeof value === "string" && AUTH_PROVIDERS.includes(value) ? value : void 0;
  var toOptionalString = (value) => typeof value === "string" && value !== "" ? value : void 0;
  var toRoles = (appMeta) => {
    const roles = appMeta.roles;
    if (Array.isArray(roles) && roles.every((r) => typeof r === "string")) {
      return roles;
    }
    return void 0;
  };
  var toUser = (userData) => {
    const userMeta = userData.user_metadata ?? {};
    const appMeta = userData.app_metadata ?? {};
    const name = userMeta.full_name ?? userMeta.name;
    const pictureUrl = userMeta.avatar_url;
    return {
      id: userData.id,
      email: userData.email,
      confirmedAt: toOptionalString(userData.confirmed_at),
      createdAt: userData.created_at,
      updatedAt: userData.updated_at,
      role: toOptionalString(userData.role),
      provider: toAuthProvider(appMeta.provider),
      name: typeof name === "string" ? name : void 0,
      pictureUrl: typeof pictureUrl === "string" ? pictureUrl : void 0,
      roles: toRoles(appMeta),
      invitedAt: toOptionalString(userData.invited_at),
      confirmationSentAt: toOptionalString(userData.confirmation_sent_at),
      recoverySentAt: toOptionalString(userData.recovery_sent_at),
      pendingEmail: toOptionalString(userData.new_email),
      emailChangeSentAt: toOptionalString(userData.email_change_sent_at),
      lastSignInAt: toOptionalString(userData.last_sign_in_at),
      userMetadata: userMeta,
      appMetadata: appMeta
    };
  };
  var claimsToUser = (claims) => {
    const appMeta = claims.app_metadata ?? {};
    const userMeta = claims.user_metadata ?? {};
    const name = userMeta.full_name ?? userMeta.name;
    const pictureUrl = userMeta.avatar_url;
    return {
      id: claims.sub ?? "",
      email: claims.email,
      provider: toAuthProvider(appMeta.provider),
      name: typeof name === "string" ? name : void 0,
      pictureUrl: typeof pictureUrl === "string" ? pictureUrl : void 0,
      roles: toRoles(appMeta),
      userMetadata: userMeta,
      appMetadata: appMeta
    };
  };
  var decodeJwtPayload = (token) => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(payload);
    } catch {
      return null;
    }
  };
  var fetchFullUser = async (identityUrl, jwt) => {
    try {
      const res = await fetchWithTimeout(`${identityUrl}/user`, {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      if (!res.ok) return null;
      const userData = await res.json();
      return toUser(userData);
    } catch {
      return null;
    }
  };
  var resolveIdentityUrl = () => {
    const identityContext = getIdentityContext();
    if (identityContext?.url) return identityContext.url;
    if (globalThis.Netlify?.context?.url) {
      return new URL(IDENTITY_PATH, globalThis.Netlify.context.url).href;
    }
    const siteUrl = typeof process !== "undefined" ? process.env?.URL : void 0;
    if (siteUrl) {
      return new URL(IDENTITY_PATH, siteUrl).href;
    }
    return null;
  };
  var getUser = async () => {
    if (isBrowser2()) {
      const client = getGoTrueClient();
      const currentUser3 = client?.currentUser() ?? null;
      if (currentUser3) {
        const jwt2 = getCookie(NF_JWT_COOKIE);
        if (!jwt2) {
          try {
            currentUser3.clearSession();
          } catch {
          }
          return null;
        }
        startTokenRefresh();
        return toUser(currentUser3);
      }
      const jwt = getCookie(NF_JWT_COOKIE);
      if (!jwt) return null;
      const claims2 = decodeJwtPayload(jwt);
      if (!claims2) return null;
      const hydrated = await hydrateSession();
      return hydrated ?? null;
    }
    triggerNextjsDynamic();
    const identityContext = globalThis.netlifyIdentityContext;
    const serverJwt = identityContext?.token ?? getServerCookie(NF_JWT_COOKIE);
    if (serverJwt) {
      const identityUrl = resolveIdentityUrl();
      if (identityUrl) {
        const fullUser = await fetchFullUser(identityUrl, serverJwt);
        if (fullUser) return fullUser;
      }
    }
    const claims = identityContext?.user ?? null;
    return claims ? claimsToUser(claims) : null;
  };
  var resolveCurrentUser = async () => {
    const client = getClient();
    let currentUser3 = client.currentUser();
    if (!currentUser3 && isBrowser2()) {
      try {
        await hydrateSession();
      } catch {
      }
      currentUser3 = client.currentUser();
    }
    if (!currentUser3) throw new AuthError("No user is currently logged in");
    return currentUser3;
  };
  var requestPasswordRecovery = async (email) => {
    const client = getClient();
    try {
      await client.requestPasswordRecovery(email);
    } catch (error) {
      throw AuthError.from(error);
    }
  };
  var acceptInvite = async (token, password) => {
    const client = getClient();
    try {
      const gotrueUser = await client.acceptInvite(token, password, persistSession);
      const user = toUser(gotrueUser);
      startTokenRefresh();
      emitAuthEvent(AUTH_EVENTS.LOGIN, user);
      return user;
    } catch (error) {
      throw AuthError.from(error);
    }
  };
  var updateUser = async (updates) => {
    const currentUser3 = await resolveCurrentUser();
    try {
      const updatedUser = await currentUser3.update(updates);
      const user = toUser(updatedUser);
      emitAuthEvent(AUTH_EVENTS.USER_UPDATED, user);
      return user;
    } catch (error) {
      throw AuthError.from(error);
    }
  };

  // assets/dev-backend.js
  function readLiveFlag() {
    try {
      const p = new URLSearchParams(location.search).get("live");
      if (p === "1") sessionStorage.setItem("sst_live", "1");
      if (p === "0") sessionStorage.removeItem("sst_live");
      return sessionStorage.getItem("sst_live") === "1";
    } catch {
      return false;
    }
  }
  var DEV = (() => {
    try {
      if (location.protocol === "file:") return true;
      const h = location.hostname;
      const local = h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost") || h.endsWith(".github.io");
      return local && !readLiveFlag();
    } catch {
      return false;
    }
  })();
  var DEBUG_EMAIL = "debug@safespace.test";
  var DEBUG_PASSWORD = "debug1234";
  var DEBUG_PRIVATE = { id: "debug-private", email: DEBUG_EMAIL, name: "Debug Private", createdAt: "2026-01-01T00:00:00.000Z" };
  var DEBUG_DOCTOR = { id: "debug-doctor", email: DEBUG_EMAIL, name: "Debug Doctor" };
  var DB_KEY = "sst_dev_db";
  var SESSION_KEY = "sst_dev_session";
  var read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  var write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
    }
  };
  var loadDb = () => ({ accounts: [], journals: [], bookings: [], affirmations: null, summaries: [], ...read(DB_KEY, {}) });
  var saveDb = (db) => write(DB_KEY, db);
  var newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  var fail = (status, message) => Object.assign(new Error(message), { status });
  function resetDevData() {
    try {
      localStorage.removeItem(DB_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch {
    }
  }
  function devCurrentUser() {
    return read(SESSION_KEY, null);
  }
  function devSignIn(email, password, role2) {
    email = email.trim().toLowerCase();
    if (email === DEBUG_EMAIL && password === DEBUG_PASSWORD) {
      const base = role2 === "doctor" ? DEBUG_DOCTOR : DEBUG_PRIVATE;
      const user2 = { ...base, roles: role2 === "doctor" ? ["doctor"] : [], confirmedAt: base.createdAt };
      write(SESSION_KEY, user2);
      return user2;
    }
    const acc = loadDb().accounts.find((a) => a.email === email);
    if (!acc || acc.password !== password) throw fail(401, "Email or password is incorrect.");
    const user = { id: acc.id, email: acc.email, name: acc.name, roles: [], createdAt: acc.createdAt, confirmedAt: acc.createdAt };
    write(SESSION_KEY, user);
    return user;
  }
  function devSignUp(email, password, name) {
    email = email.trim().toLowerCase();
    const db = loadDb();
    if (email === DEBUG_EMAIL || db.accounts.some((a) => a.email === email)) throw fail(400, "An account with this email already exists. Try signing in.");
    const acc = { id: "dev-" + newId(), email, password, name: name || "", createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    db.accounts.push(acc);
    saveDb(db);
    const user = { id: acc.id, email, name: acc.name, roles: [], createdAt: acc.createdAt, confirmedAt: acc.createdAt };
    write(SESSION_KEY, user);
    return user;
  }
  function devSignOut() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
    }
  }
  function showDevBanner() {
    if (!DEV || document.getElementById("sstDevBanner")) return;
    const bar = document.createElement("div");
    bar.id = "sstDevBanner";
    bar.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9999;max-width:calc(100% - 24px);background:#35405f;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 12px;border-radius:12px;box-shadow:0 6px 20px #0003;display:flex;gap:10px;align-items:center;flex-wrap:wrap";
    bar.textContent = "Debug mode: data stays in this browser only.";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Reset debug data";
    reset.style.cssText = "border:1px solid #ffffff66;background:transparent;color:#fff;border-radius:999px;padding:3px 10px;font:inherit;cursor:pointer";
    reset.onclick = () => {
      if (!confirm("Delete all debug accounts, journals, bookings and settings in this browser?")) return;
      resetDevData();
      location.href = "login.html";
    };
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "\u2715";
    close.setAttribute("aria-label", "Hide debug banner");
    close.style.cssText = "border:0;background:transparent;color:#fff;font:inherit;cursor:pointer;padding:0 2px";
    close.onclick = () => bar.remove();
    bar.append(reset, close);
    document.body.append(bar);
  }

  // assets/auth.js
  var DOCTOR_ROLE = "doctor";
  var REMEMBER_KEY = "sst_remember";
  var KEEP_DAYS = 30;
  var isDoctor = (user) => Array.isArray(user?.roles) && user.roles.includes(DOCTOR_ROLE);
  var safe = (fn, fallback = null) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  var getRemember = () => safe(() => localStorage.getItem(REMEMBER_KEY) === "1", false);
  var setRemember = (on) => safe(() => on ? localStorage.setItem(REMEMBER_KEY, "1") : localStorage.removeItem(REMEMBER_KEY));
  var readCookie = (name) => {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  };
  var writeCookie = (name, value, days) => {
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; samesite=lax${secure}; max-age=${days * 86400}`;
  };
  function keepCookies() {
    if (!getRemember()) return;
    const jwt = readCookie("nf_jwt");
    const refresh = readCookie("nf_refresh");
    if (jwt) writeCookie("nf_jwt", jwt, KEEP_DAYS);
    if (refresh) writeCookie("nf_refresh", refresh, KEEP_DAYS);
  }
  function restoreCookies() {
    if (!getRemember() || readCookie("nf_jwt")) return;
    const saved = safe(() => JSON.parse(localStorage.getItem("gotrue.user")));
    const token = saved?.token;
    if (token?.access_token) writeCookie("nf_jwt", token.access_token, KEEP_DAYS);
    if (token?.refresh_token) writeCookie("nf_refresh", token.refresh_token, KEEP_DAYS);
  }
  if (!DEV) {
    onAuthChange((event) => {
      if (event === "login" || event === "token_refresh") keepCookies();
    });
  }
  async function currentUser2() {
    if (DEV) return devCurrentUser();
    restoreCookies();
    const user = await getUser();
    if (!user) return null;
    try {
      await refreshSession();
    } catch {
    }
    keepCookies();
    return user;
  }
  async function signIn(email, password, remember, role2) {
    if (DEV) return devSignIn(email, password, role2);
    setRemember(remember);
    const user = await login(email, password);
    keepCookies();
    return user;
  }
  async function signOut() {
    if (DEV) return devSignOut();
    setRemember(false);
    try {
      await logout();
    } catch {
    }
  }
  var signUp = async (email, password, name) => DEV ? devSignUp(email, password, name) : signup(email, password, name ? { full_name: name } : void 0);
  var requestPasswordRecovery2 = async (email) => {
    if (DEV) throw new Error("Password reset emails only work on the Netlify site. In debug mode, use the debug account.");
    return requestPasswordRecovery(email);
  };
  var handleAuthCallback2 = async () => DEV ? null : handleAuthCallback();
  var acceptInvite2 = (token, password) => acceptInvite(token, password);
  var updatePassword = (password) => updateUser({ password });

  // assets/login.js
  var $ = (id) => document.getElementById(id);
  var params = new URLSearchParams(location.search);
  var role = params.get("as") === "doctor" ? "doctor" : "private";
  var mode = "signin";
  var inviteToken = null;
  var reasons = {
    "signed-out": "You have been signed out.",
    "not-doctor": "That account does not have doctor access.",
    "is-doctor": "This is a doctor account. Please sign in as Doctor.",
    expired: "Your session has ended. Please sign in again."
  };
  function setStatus(text, kind = "") {
    $("status").textContent = text;
    $("status").className = "status" + (kind ? " " + kind : "");
  }
  function render() {
    document.querySelectorAll("[data-role]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === role)));
    document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    const special = mode === "invite" || mode === "recovery";
    $("roleBlock").classList.toggle("hidden", special);
    $("privateTabs").classList.toggle("hidden", role !== "private" || mode === "forgot");
    $("nameRow").classList.toggle("hidden", !(role === "private" && mode === "signup"));
    $("emailRow").classList.toggle("hidden", special);
    $("passwordRow").classList.toggle("hidden", mode === "forgot");
    $("rememberRow").classList.toggle("hidden", mode === "signup" || mode === "forgot");
    $("forgotBtn").textContent = mode === "forgot" ? "\u2190 Back to sign in" : "Forgot password?";
    $("forgotBtn").classList.toggle("hidden", special || mode === "signup");
    $("doctorNote").classList.toggle("hidden", role !== "doctor" || mode !== "signin");
    $("password").autocomplete = mode === "signin" ? "current-password" : "new-password";
    const copy = {
      signin: [role === "doctor" ? "Doctor sign in" : "Sign in", role === "doctor" ? "View booking enquiries, weekly summaries and the affirmation library." : "Your journal is saved to your account, on every device.", "Sign in"],
      signup: ["Create your account", "A private space for your journal. Only you can read entries you do not share.", "Create account"],
      forgot: ["Reset your password", "We will email you a link to choose a new password.", "Send reset link"],
      invite: ["Set up your account", "You have been invited to Safe Space Therapy. Choose a password to finish.", "Save password"],
      recovery: ["Choose a new password", "Enter a new password for your account.", "Save new password"]
    }[mode];
    $("loginTitle").textContent = copy[0];
    $("loginSub").textContent = copy[1];
    $("submitBtn").textContent = copy[2];
  }
  function destination(user) {
    if (isDoctor(user)) return "doctor.html";
    const next = params.get("next");
    return next && /^[a-z-]+\.html$/.test(next) && next !== "doctor.html" ? next : "index.html";
  }
  async function enter(user) {
    if (role === "doctor" && !isDoctor(user)) {
      await signOut();
      return setStatus(reasons["not-doctor"], "error");
    }
    if (role === "private" && isDoctor(user)) {
      await signOut();
      return setStatus(reasons["is-doctor"], "error");
    }
    location.replace(destination(user));
  }
  var friendly = (err) => {
    const msg = String(err?.message || err || "");
    if (/invalid_grant|No user found|Invalid Password|invalid login/i.test(msg)) return "Email or password is incorrect.";
    if (/not confirmed|Email not confirmed/i.test(msg)) return "Please confirm your email first. Check your inbox for the link.";
    if (/already (been )?registered|already exists/i.test(msg)) return "An account with this email already exists. Try signing in.";
    if (/Signups not allowed|signup.*disabled/i.test(msg)) return "New accounts are not open right now.";
    if (/Identity|MissingIdentity|404|Unsupported method|Failed to fetch|Unexpected token/i.test(msg)) return "Sign-in is not available yet. Netlify Identity needs to be turned on for this site.";
    return msg || "Something went wrong. Please try again.";
  };
  document.querySelectorAll("[data-role]").forEach((b) => b.onclick = () => {
    role = b.dataset.role;
    mode = "signin";
    setStatus("");
    render();
  });
  document.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => {
    mode = b.dataset.mode;
    setStatus("");
    render();
  });
  $("forgotBtn").onclick = () => {
    mode = mode === "forgot" ? "signin" : "forgot";
    setStatus("");
    render();
  };
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("email").value.trim();
    const password = $("password").value;
    if (mode !== "invite" && mode !== "recovery" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setStatus("Please enter a valid email.", "error");
    if (mode !== "forgot" && password.length < 8) return setStatus("Password needs at least 8 characters.", "error");
    $("submitBtn").disabled = true;
    setStatus("Please wait\u2026");
    try {
      if (mode === "signin") {
        await enter(await signIn(email, password, $("remember").checked, role));
      } else if (mode === "signup") {
        const user = await signUp(email, password, $("name").value.trim());
        if (user?.confirmedAt) return enter(user);
        mode = "signin";
        render();
        setStatus("Account created. Check your email and click the confirmation link, then sign in here.", "ok");
      } else if (mode === "forgot") {
        await requestPasswordRecovery2(email);
        setStatus("If that email has an account, a reset link is on its way.", "ok");
      } else if (mode === "invite") {
        const user = await acceptInvite2(inviteToken, password);
        role = isDoctor(user) ? "doctor" : "private";
        await enter(user);
      } else if (mode === "recovery") {
        const user = await updatePassword(password);
        role = isDoctor(user) ? "doctor" : "private";
        await enter(user);
      }
    } catch (err) {
      setStatus(friendly(err), "error");
    } finally {
      $("submitBtn").disabled = false;
    }
  });
  async function start() {
    render();
    if (DEV) setupDebugBox();
    if (reasons[params.get("reason")]) setStatus(reasons[params.get("reason")], params.get("reason") === "signed-out" ? "ok" : "error");
    if (/_token=/.test(location.hash)) {
      try {
        const result = await handleAuthCallback2();
        history.replaceState(null, "", location.pathname + location.search);
        if (result?.type === "invite" && result.token) {
          inviteToken = result.token;
          mode = "invite";
          return render();
        }
        if (result?.type === "recovery") {
          mode = "recovery";
          return render();
        }
        if (result?.user) {
          role = isDoctor(result.user) ? "doctor" : "private";
          return enter(result.user);
        }
      } catch (err) {
        return setStatus("This link has expired or was already used. " + friendly(err), "error");
      }
    }
    if (!params.get("reason")) {
      const user = await currentUser2().catch(() => null);
      if (user) {
        role = isDoctor(user) ? "doctor" : "private";
        location.replace(destination(user));
      }
    }
  }
  start();
  function setupDebugBox() {
    showDevBanner();
    const box = document.createElement("div");
    box.className = "debug-box";
    box.innerHTML = "<strong>Debug mode</strong><span>Netlify sign-in is not available here, so a local debug account is used. It works for both Private and Doctor.</span>";
    const creds = document.createElement("code");
    creds.textContent = `${DEBUG_EMAIL} / ${DEBUG_PASSWORD}`;
    const fill = document.createElement("button");
    fill.type = "button";
    fill.className = "btn secondary small";
    fill.textContent = "Use debug account";
    fill.onclick = () => {
      mode = "signin";
      render();
      $("email").value = DEBUG_EMAIL;
      $("password").value = DEBUG_PASSWORD;
      $("submitBtn").focus();
    };
    box.append(creds, fill);
    $("authForm").before(box);
  }
})();
