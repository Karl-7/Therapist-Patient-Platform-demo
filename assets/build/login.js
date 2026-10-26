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

  // netlify/lib/default-affirmations.mjs
  var FIRST = [
    { id: "a1", category: "Stress & Anxiety", tags: ["anxious", "calm", "breathing"], text: "I can take one slow breath at a time. I do not have to solve everything right now." },
    { id: "a2", category: "Stress & Anxiety", tags: ["stress", "rest", "pause"], text: "I am allowed to pause. Rest is part of moving forward." },
    { id: "a3", category: "Stress & Anxiety", tags: ["overwhelmed", "small steps"], text: "One small step is enough for today. I can move at my own pace." },
    { id: "a4", category: "Self-Compassion", tags: ["sad", "kindness", "gentle"], text: "It is okay to feel what I feel. I can meet myself with kindness today." },
    { id: "a5", category: "Self-Compassion", tags: ["self worth", "worthy", "love"], text: "I deserve the same patience and care that I offer to the people I love." },
    { id: "a6", category: "Mindfulness", tags: ["present", "mindful", "now"], text: "I can return to this moment, gently, without needing to change anything." },
    { id: "a7", category: "ADHD Support", tags: ["adhd", "focus", "different"], text: "My mind does not need to work like anyone else\u2019s for me to be worthy and capable." },
    { id: "a8", category: "Confidence", tags: ["confidence", "brave", "courage"], text: "I can feel unsure and still take a brave next step." },
    { id: "a9", category: "Relationships", tags: ["lonely", "connection", "love"], text: "I am worthy of relationships where care, honesty, and respect can grow." },
    { id: "a10", category: "Self-Compassion", tags: ["confused", "answers", "clarity"], text: "I do not need every answer today. Clarity can come one step at a time." },
    { id: "a11", category: "Mindfulness", tags: ["okay", "enough", "ordinary"], text: "I do not need to feel amazing every day. Being okay is enough." },
    { id: "a12", category: "Confidence", tags: ["good", "progress", "proud"], text: "I can notice my progress, even when it feels small." },
    { id: "a13", category: "Confidence", tags: ["great", "celebrate", "growth"], text: "I can celebrate how far I have come and still give myself room to grow." },
    { id: "a14", category: "Relationships", tags: ["angry", "feelings", "space"], text: "My feelings are valid. I can give myself space before choosing my next step." },
    { id: "a15", category: "Mindfulness", tags: ["happy", "joy", "enjoy"], text: "My joy is allowed to take up space. I can let myself enjoy this moment." },
    { id: "a16", category: "Self-Compassion", tags: ["low", "tired", "enough"], text: "Even on a difficult day, I am still worthy of tenderness and care." }
  ];
  var MORE = {
    "Stress & Anxiety": [
      [["anxious", "breathing", "body"], "My breath is always with me. I can come back to it whenever I need."],
      [["worry", "future", "present"], "Worry is not a prediction. Right now, I am safe enough to take one breath."],
      [["panic", "calm", "grounding"], "This feeling is strong, and it will pass. I can let it rise and fall."],
      [["overthinking", "thoughts", "calm"], "I do not have to follow every thought. I can let some of them drift by."],
      [["stress", "control", "letting go"], "I can focus on what is in my hands and gently set down the rest."],
      [["nervous", "brave", "courage"], "I can feel nervous and still show up. Courage often feels like this."],
      [["tense", "body", "relax"], "I can soften my shoulders, unclench my jaw, and let my body rest a little."],
      [["uncertainty", "trust", "future"], "I do not need every answer today. I can handle things as they come."],
      [["busy", "pace", "slow"], "Slowing down is not falling behind. It is how I take care of myself."]
    ],
    "Self-Compassion": [
      [["mistake", "kindness", "learning"], "Making a mistake does not make me a mistake. I can learn and keep going."],
      [["self criticism", "kindness", "voice"], "I can speak to myself the way I would speak to someone I love."],
      [["enough", "worth", "self worth"], "I am enough as I am, even while I am still growing."],
      [["tired", "rest", "permission"], "Rest is not something I have to earn. I am allowed to stop."],
      [["guilt", "forgive", "past"], "I can forgive the version of me who was doing the best they could."],
      [["hard day", "gentle", "care"], "On hard days, small acts of care still count."],
      [["perfection", "progress", "enough"], "I do not need to be perfect to be worthy of love and care."],
      [["feelings", "allowed", "emotions"], "All of my feelings are allowed. None of them make me too much."],
      [["healing", "time", "patience"], "Healing is not a straight line. I can be patient with my own pace."]
    ],
    "Mindfulness": [
      [["present", "now", "grounding"], "Right now, I can notice five things I see and let my mind settle."],
      [["breathing", "calm", "present"], "With each breath out, I can let go of a little tension."],
      [["moment", "enough", "present"], "This moment does not need to be special. It only needs to be lived."],
      [["noticing", "curious", "thoughts"], "I can watch my thoughts with curiosity, like clouds passing by."],
      [["senses", "body", "grounding"], "My feet are on the ground. I am here, in this body, in this moment."],
      [["slow", "simple", "peace"], "Peace can be found in simple things: warm tea, quiet light, a slow breath."],
      [["acceptance", "feelings", "present"], "I can let this moment be as it is, without fighting it."],
      [["gratitude", "small things", "joy"], "I can notice one small good thing around me right now."]
    ],
    "ADHD Support": [
      [["adhd", "focus", "start"], "Starting is the hardest part. Two minutes is a good enough beginning."],
      [["adhd", "brain", "different"], "My brain works differently, not wrongly. I can work with it, not against it."],
      [["adhd", "forgetful", "kindness"], "Forgetting something does not mean I do not care. I can try again."],
      [["adhd", "energy", "interest"], "My curiosity and energy are strengths, too."],
      [["adhd", "routine", "tools"], "Using reminders and tools is smart, not a weakness."],
      [["adhd", "overwhelmed", "one thing"], "I only need to choose one thing to do next."],
      [["adhd", "rest", "hyperfocus"], "I can pause, drink some water, and come back with fresh eyes."],
      [["adhd", "self worth", "productivity"], "My worth is not measured by how productive I was today."]
    ],
    "Confidence": [
      [["confidence", "voice", "speak"], "My voice matters. I am allowed to take up space."],
      [["brave", "try", "growth"], "Trying something new is brave, whatever the result."],
      [["proud", "progress", "notice"], "I can be proud of how far I have come, not only of where I am going."],
      [["doubt", "confidence", "trust"], "I can trust myself a little more each day."],
      [["boundaries", "no", "confidence"], "Saying no to others can be saying yes to myself."],
      [["strength", "resilience", "past"], "I have handled hard things before. I can handle this, too."],
      [["comparison", "own path", "enough"], "My path is my own. I do not need to compare it to anyone else."],
      [["growth", "learning", "future"], "I am capable of learning, changing, and growing."]
    ],
    "Relationships": [
      [["love", "connection", "worthy"], "I deserve relationships where I feel safe and respected."],
      [["boundaries", "relationships", "respect"], "Healthy boundaries help my relationships grow stronger."],
      [["lonely", "connection", "reach out"], "Reaching out is a strength. Someone would be glad to hear from me."],
      [["conflict", "calm", "listen"], "I can listen with an open heart and still stay true to myself."],
      [["family", "patience", "love"], "I can love my family and still need some space."],
      [["friendship", "gratitude", "connection"], "I am grateful for the people who make me feel at home."],
      [["hurt", "healing", "trust"], "Being hurt before does not mean I cannot find safe connection again."],
      [["partner", "communication", "honest"], "I can share how I feel honestly and kindly."]
    ],
    "Sleep & Rest": [
      [["sleep", "night", "rest"], "The day is done. I can let it go and rest now."],
      [["sleep", "thoughts", "tomorrow"], "My thoughts can wait until morning. Right now is for rest."],
      [["insomnia", "calm", "body"], "Even if sleep is slow to come, resting quietly still helps my body."],
      [["tired", "rest", "recharge"], "Rest is how I recharge. I give myself permission to slow down."],
      [["evening", "peace", "letting go"], "I did enough today. I can put the day down gently."],
      [["night", "safe", "breathing"], "I am safe in this moment. I can breathe slowly and let my body soften."]
    ],
    "Grief & Loss": [
      [["grief", "loss", "love"], "Grief is love with nowhere to go. It is okay to miss them."],
      [["grief", "time", "healing"], "There is no right way or timeline for grief."],
      [["loss", "sad", "allowed"], "I am allowed to feel sad and still have moments of joy."],
      [["memory", "love", "remember"], "The love I shared is still part of me."],
      [["grief", "gentle", "care"], "On heavy days, I can be extra gentle with myself."],
      [["change", "loss", "new"], "Endings are hard. I can grieve what was and slowly make room for what comes next."]
    ],
    "Anger & Frustration": [
      [["angry", "feelings", "allowed"], "Anger tells me something matters. I can listen without letting it take over."],
      [["frustrated", "pause", "breathing"], "Before I react, I can take one long breath out."],
      [["angry", "calm", "space"], "I can step away, cool down, and come back when I am ready."],
      [["irritable", "needs", "care"], "When I feel short-tempered, I can check if I am tired, hungry, or overwhelmed."],
      [["conflict", "boundaries", "anger"], "I can express my anger in ways that respect me and others."]
    ],
    "Motivation": [
      [["motivation", "start", "small steps"], "I do not need motivation to begin. Starting often brings it."],
      [["progress", "small steps", "consistency"], "Small steps, taken often, add up to big changes."],
      [["stuck", "move", "gentle"], "Feeling stuck is temporary. One tiny action can get me moving again."],
      [["goals", "patience", "growth"], "I can work towards my goals at a pace I can keep."],
      [["procrastination", "kindness", "start"], "I can begin badly. Beginning is what counts."],
      [["hope", "future", "possible"], "Good things are still possible for me."]
    ],
    "Body & Health": [
      [["body", "kindness", "gratitude"], "My body carries me through every day. I can treat it with kindness."],
      [["eating", "care", "nourish"], "Nourishing my body is an act of self-care."],
      [["movement", "walk", "energy"], "A short walk or stretch can help me feel a little lighter."],
      [["pain", "patience", "body"], "On days my body hurts, I can listen to it and rest."],
      [["body image", "worth", "acceptance"], "My worth is not decided by how my body looks."],
      [["health", "water", "basics"], "Water, food, rest, fresh air: the basics are a good place to start."]
    ],
    "Work & Study": [
      [["work", "stress", "boundaries"], "My job is something I do, not who I am."],
      [["study", "exam", "calm"], "I have prepared what I can. I will do my best, and that is enough."],
      [["deadline", "one task", "focus"], "I can take this one task at a time."],
      [["work", "rest", "balance"], "Logging off is part of doing good work."],
      [["feedback", "growth", "learning"], "Feedback helps me grow. It does not define my worth."],
      [["mistake", "work", "learning"], "Everyone makes mistakes at work. I can fix what I can and move on."]
    ],
    "Parenting": [
      [["parent", "enough", "love"], "I do not have to be a perfect parent. A loving, present one is enough."],
      [["parent", "patience", "calm"], "When things get loud, I can be the calm my child needs, or take a moment to find it."],
      [["parent", "repair", "mistake"], "If I lose my temper, I can repair. Repair teaches love, too."],
      [["parent", "self care", "rest"], "Taking care of myself helps me take care of my family."],
      [["parent", "tired", "kindness"], "Being tired does not make me a bad parent. I am doing a lot."]
    ]
  };
  var n = FIRST.length;
  var DEFAULT_AFFIRMATIONS = [
    ...FIRST,
    ...Object.entries(MORE).flatMap(([category, items]) => items.map(([tags, text]) => ({ id: `a${++n}`, category, tags, text })))
  ];

  // assets/dev-sample-people.js
  var POOLS = {
    en: {
      low: [
        "Woke up at 4am again and could not get back to sleep.",
        "Felt heavy all day, like everything took twice the effort.",
        "Snapped at someone I care about and felt guilty afterwards.",
        "Skipped lunch, too wound up to eat.",
        "Cried in the car before going inside.",
        "Kept replaying a conversation from yesterday in my head.",
        "Cancelled plans because I did not have the energy.",
        "My chest felt tight most of the afternoon."
      ],
      mid: [
        "An ordinary day. Nothing great, nothing terrible.",
        "Got through most of my to-do list.",
        "Had a short walk at lunch, which helped a bit.",
        "Still tired, but less tense than last week.",
        "Talked to a friend on the phone for a while.",
        "Tried the breathing exercise before bed.",
        "A bit restless in the evening but managed to read.",
        "Some worry in the morning that faded by the afternoon."
      ],
      high: [
        "Slept through the night for the first time in ages.",
        "Laughed a lot at dinner. Felt like myself.",
        "Went for a long walk and noticed the trees changing colour.",
        "Felt proud that I said no to extra work.",
        "A calm, easy day. I want more of these.",
        "Cooked a proper meal and enjoyed it.",
        "Felt hopeful about the next few weeks.",
        "Did the breathing exercise and it actually helped."
      ],
      titles: ["Evening", "Today", "Quick note", "Before bed"]
    },
    ar: {
      low: [
        "\u0627\u0633\u062A\u064A\u0642\u0638\u062A \u0641\u064A \u0627\u0644\u0631\u0627\u0628\u0639\u0629 \u0641\u062C\u0631\u064B\u0627 \u0648\u0644\u0645 \u0623\u0633\u062A\u0637\u0639 \u0627\u0644\u0646\u0648\u0645 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.",
        "\u0634\u0639\u0631\u062A \u0628\u062B\u0642\u0644 \u0637\u0648\u0627\u0644 \u0627\u0644\u064A\u0648\u0645\u060C \u0648\u0643\u0644 \u0634\u064A\u0621 \u0643\u0627\u0646 \u064A\u062D\u062A\u0627\u062C \u062C\u0647\u062F\u064B\u0627 \u0645\u0636\u0627\u0639\u0641\u064B\u0627.",
        "\u062A\u0634\u0627\u062C\u0631\u062A \u0645\u0639 \u0623\u062E\u064A \u0639\u0644\u0649 \u0634\u064A\u0621 \u0635\u063A\u064A\u0631 \u0648\u0646\u062F\u0645\u062A \u0628\u0639\u062F\u0647\u0627.",
        "\u0644\u0645 \u0622\u0643\u0644 \u0634\u064A\u0626\u064B\u0627 \u062A\u0642\u0631\u064A\u0628\u064B\u0627 \u0627\u0644\u064A\u0648\u0645.",
        "\u0628\u0642\u064A\u062A \u0641\u064A \u063A\u0631\u0641\u062A\u064A \u0645\u0639\u0638\u0645 \u0627\u0644\u064A\u0648\u0645 \u0648\u0644\u0645 \u0623\u0631\u062F \u0639\u0644\u0649 \u0627\u0644\u0647\u0627\u062A\u0641.",
        "\u0623\u0641\u0643\u0627\u0631 \u0643\u062B\u064A\u0631\u0629 \u0641\u064A \u0631\u0623\u0633\u064A \u0648\u0644\u0627 \u0623\u0633\u062A\u0637\u064A\u0639 \u0625\u064A\u0642\u0627\u0641\u0647\u0627.",
        "\u0623\u0644\u063A\u064A\u062A \u0645\u0648\u0639\u062F\u064B\u0627 \u0645\u0639 \u0635\u062F\u064A\u0642 \u0644\u0623\u0646\u0646\u064A \u0644\u0645 \u0623\u0643\u0646 \u0642\u0627\u062F\u0631\u064B\u0627.",
        "\u0634\u0639\u0631\u062A \u0628\u0636\u064A\u0642 \u0641\u064A \u0635\u062F\u0631\u064A \u0628\u0639\u062F \u0627\u0644\u0638\u0647\u0631."
      ],
      mid: [
        "\u064A\u0648\u0645 \u0639\u0627\u062F\u064A\u060C \u0644\u0627 \u0634\u064A\u0621 \u0645\u0645\u064A\u0632.",
        "\u0623\u0646\u062C\u0632\u062A \u0645\u0639\u0638\u0645 \u0645\u0627 \u0643\u0627\u0646 \u0639\u0644\u064A \u0641\u0639\u0644\u0647.",
        "\u0645\u0634\u064A\u062A \u0642\u0644\u064A\u0644\u064B\u0627 \u0628\u0639\u062F \u0627\u0644\u0639\u0635\u0631 \u0648\u0633\u0627\u0639\u062F\u0646\u064A \u0630\u0644\u0643.",
        "\u0645\u0627 \u0632\u0644\u062A \u0645\u062A\u0639\u0628\u064B\u0627 \u0644\u0643\u0646 \u0623\u0642\u0644 \u062A\u0648\u062A\u0631\u064B\u0627 \u0645\u0646 \u0627\u0644\u0623\u0633\u0628\u0648\u0639 \u0627\u0644\u0645\u0627\u0636\u064A.",
        "\u062A\u062D\u062F\u062B\u062A \u0645\u0639 \u0635\u062F\u064A\u0642 \u0639\u0644\u0649 \u0627\u0644\u0647\u0627\u062A\u0641 \u0644\u0628\u0639\u0636 \u0627\u0644\u0648\u0642\u062A.",
        "\u062C\u0631\u0628\u062A \u062A\u0645\u0631\u064A\u0646 \u0627\u0644\u062A\u0646\u0641\u0633 \u0642\u0628\u0644 \u0627\u0644\u0646\u0648\u0645.",
        "\u0642\u0644\u0642 \u062E\u0641\u064A\u0641 \u0641\u064A \u0627\u0644\u0635\u0628\u0627\u062D \u062B\u0645 \u0647\u062F\u0623\u062A.",
        "\u0642\u0631\u0623\u062A \u0642\u0644\u064A\u0644\u064B\u0627 \u0641\u064A \u0627\u0644\u0645\u0633\u0627\u0621."
      ],
      high: [
        "\u0646\u0645\u062A \u062C\u064A\u062F\u064B\u0627 \u0644\u0623\u0648\u0644 \u0645\u0631\u0629 \u0645\u0646\u0630 \u0645\u062F\u0629 \u0637\u0648\u064A\u0644\u0629.",
        "\u0636\u062D\u0643\u0646\u0627 \u0643\u062B\u064A\u0631\u064B\u0627 \u0639\u0644\u0649 \u0627\u0644\u0639\u0634\u0627\u0621 \u0645\u0639 \u0627\u0644\u0639\u0627\u0626\u0644\u0629.",
        "\u062E\u0631\u062C\u062A \u0641\u064A \u0646\u0632\u0647\u0629 \u0637\u0648\u064A\u0644\u0629 \u0648\u0634\u0639\u0631\u062A \u0628\u0627\u0644\u0631\u0627\u062D\u0629.",
        "\u0634\u0639\u0631\u062A \u0628\u0627\u0644\u0641\u062E\u0631 \u0644\u0623\u0646\u0646\u064A \u0623\u0646\u0647\u064A\u062A \u0639\u0645\u0644\u064A \u0641\u064A \u0648\u0642\u062A\u0647.",
        "\u064A\u0648\u0645 \u0647\u0627\u062F\u0626 \u0648\u062C\u0645\u064A\u0644.",
        "\u0637\u0628\u062E\u062A \u0623\u0643\u0644\u0629 \u0623\u062D\u0628\u0647\u0627 \u0648\u0627\u0633\u062A\u0645\u062A\u0639\u062A \u0628\u0647\u0627.",
        "\u0623\u0634\u0639\u0631 \u0628\u0627\u0644\u0623\u0645\u0644 \u062A\u062C\u0627\u0647 \u0627\u0644\u0623\u0633\u0627\u0628\u064A\u0639 \u0627\u0644\u0642\u0627\u062F\u0645\u0629.",
        "\u062A\u0645\u0631\u064A\u0646 \u0627\u0644\u062A\u0646\u0641\u0633 \u0633\u0627\u0639\u062F\u0646\u064A \u0641\u0639\u0644\u064B\u0627 \u0627\u0644\u064A\u0648\u0645."
      ],
      titles: ["\u0645\u0633\u0627\u0621", "\u0627\u0644\u064A\u0648\u0645", "\u0645\u0644\u0627\u062D\u0638\u0629 \u0633\u0631\u064A\u0639\u0629", "\u0642\u0628\u0644 \u0627\u0644\u0646\u0648\u0645"]
    }
  };
  var PEOPLE = [
    {
      id: "sample-sara",
      name: "Sara Ahmed",
      email: "sara@example.test",
      lang: "en",
      mood: [3, 4, 5, 6, 7],
      topics: ["Big deadline at work this week.", "My manager asked for another report at 6pm.", "Set myself a rule: no work emails after 7pm.", "The project review went better than I feared."]
    },
    {
      id: "sample-omar",
      name: "Omar Haddad",
      email: "omar@example.test",
      lang: "ar",
      mood: [6, 5, 3, 4, 6],
      topics: ["\u0627\u0644\u0648\u0636\u0639 \u0641\u064A \u0627\u0644\u0628\u064A\u062A \u0645\u062A\u0648\u062A\u0631 \u0628\u0633\u0628\u0628 \u0627\u0644\u062E\u0644\u0627\u0641\u0627\u062A.", "\u0648\u0627\u0644\u062F\u064A \u0645\u0631\u064A\u0636 \u0648\u0623\u0646\u0627 \u0642\u0644\u0642 \u0639\u0644\u064A\u0647.", "\u0632\u0631\u062A \u0623\u0647\u0644\u064A \u0641\u064A \u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u0623\u0633\u0628\u0648\u0639.", "\u062A\u0643\u0644\u0645\u062A \u0645\u0639 \u0632\u0648\u062C\u062A\u064A \u0628\u0647\u062F\u0648\u0621 \u0639\u0646 \u0627\u0644\u0645\u0634\u0643\u0644\u0629."]
    },
    {
      id: "sample-lina",
      name: "Lina Karim",
      email: "lina@example.test",
      lang: "en",
      mood: [5, 3, 6, 4, 7],
      topics: ["Had that racing-heart feeling again at the bus stop.", "Meeting new people at the course made me nervous.", "I think I am getting better at noticing the anxiety early.", "My sister came to visit and we went to the market."]
    },
    {
      id: "sample-yusuf",
      name: "Yusuf Nasser",
      email: "yusuf@example.test",
      lang: "ar",
      mood: [4, 4, 5, 5, 6],
      topics: ["\u0627\u0644\u0627\u0645\u062A\u062D\u0627\u0646\u0627\u062A \u0642\u0631\u064A\u0628\u0629 \u0648\u0623\u0646\u0627 \u0645\u062A\u0648\u062A\u0631.", "\u0630\u0627\u0643\u0631\u062A \u0641\u064A \u0627\u0644\u0645\u0643\u062A\u0628\u0629 \u0645\u0639 \u0632\u0645\u0644\u0627\u0626\u064A.", "\u0623\u062D\u0627\u0648\u0644 \u0623\u0646 \u0623\u0646\u0627\u0645 \u0641\u064A \u0648\u0642\u062A \u062B\u0627\u0628\u062A \u0643\u0644 \u0644\u064A\u0644\u0629.", "\u0642\u062F\u0645\u062A \u0639\u0631\u0636\u064B\u0627 \u0641\u064A \u0627\u0644\u062C\u0627\u0645\u0639\u0629 \u0648\u0645\u0631 \u0628\u0634\u0643\u0644 \u062C\u064A\u062F."]
    }
  ];
  function rng(seed) {
    return () => {
      seed |= 0;
      seed = seed + 1831565813 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function addSamplePeople(db, weekOf2, newId2) {
    const rand = rng(20261026);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const pickSome = (list, n2) => [...list].sort(() => rand() - 0.5).slice(0, n2);
    const thisMonday = /* @__PURE__ */ new Date();
    thisMonday.setHours(0, 0, 0, 0);
    thisMonday.setDate(thisMonday.getDate() - (thisMonday.getDay() + 6) % 7);
    for (const person of PEOPLE) {
      if (db.accounts.some((a) => a.id === person.id)) continue;
      const joined = new Date(thisMonday);
      joined.setDate(joined.getDate() - 7 * 6);
      db.accounts.push({ id: person.id, email: person.email, password: "debug1234", name: person.name, createdAt: joined.toISOString() });
      const pool = POOLS[person.lang];
      person.mood.forEach((mood, i) => {
        const monday = new Date(thisMonday);
        monday.setDate(monday.getDate() - 7 * (5 - i));
        const days = pickSome([0, 1, 2, 3, 4, 5, 6], 3 + Math.floor(rand() * 4)).sort((a, b) => a - b);
        const shared = new Set(pickSome(days, Math.min(days.length, 1 + Math.floor(rand() * 3))));
        days.forEach((day) => {
          const d = new Date(monday);
          d.setDate(d.getDate() + day);
          d.setHours(19 + Math.floor(rand() * 4), Math.floor(rand() * 60));
          const m = mood + Math.round(rand() * 2 - 1);
          const band = m <= 4 ? pool.low : m >= 7 ? pool.high : pool.mid;
          const parts = [rand() < 0.6 ? pick(person.topics) : null, pick(band), rand() < 0.5 ? pick(band) : null].filter(Boolean);
          const text = [...new Set(parts)].join(" ");
          const created = d.toISOString();
          db.journals.push({ id: newId2(), userId: person.id, title: rand() < 0.3 ? pick(pool.titles) : "", text, shared: shared.has(day), created, week: weekOf2(created) });
          db.queue[`${person.id}/${weekOf2(created)}`] = Date.now();
        });
      });
    }
    if (!db.bookings.some((b) => b.userId?.startsWith("sample-"))) {
      const at = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
      db.bookings.push(
        { id: newId2(), userId: "sample-lina", accountEmail: "lina@example.test", name: "Lina Karim", email: "lina@example.test", service: "Individual Therapy", session: "Online session", date: "", message: "Evenings work best for me.", status: "new", note: "", created: at(1) },
        { id: newId2(), userId: "sample-omar", accountEmail: "omar@example.test", name: "Omar Haddad", email: "omar@example.test", service: "Marriage Counselling", session: "Individual session", date: "", message: "", status: "contacted", note: "Offered Tuesday or Thursday.", created: at(6) }
      );
    }
  }

  // netlify/lib/moods.mjs
  var MOODS = [
    ["\u{1F60A}", "Happy"],
    ["\u{1F614}", "Sad"],
    ["\u{1F61F}", "Anxious"],
    ["\u{1F623}", "Stressed"],
    ["\u{1F635}", "Overwhelmed"],
    ["\u{1F61E}", "Lonely"],
    ["\u{1F610}", "Okay"],
    ["\u{1F642}", "Good"],
    ["\u{1F31E}", "Great"]
  ];
  var MOOD_NAMES = MOODS.map(([, name]) => name);

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
  function loadDb() {
    const db = { accounts: [], journals: [], bookings: [], affirmations: null, summaries: [], queue: {}, job: null, ...read(DB_KEY, {}) };
    if (!db.seeded) {
      addSamplePeople(db, weekOf, newId);
      db.seeded = true;
      saveDb(db);
    }
    return db;
  }
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
  function weekOf(iso) {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
    applyResetCooldown();
  }
  var RESET_WAIT_MS = 3 * 60 * 1e3;
  var resetTimer = null;
  var resetUntil = () => {
    try {
      return Number(localStorage.getItem("sst_reset_until")) || 0;
    } catch {
      return 0;
    }
  };
  function startResetCooldown() {
    try {
      localStorage.setItem("sst_reset_until", String(Date.now() + RESET_WAIT_MS));
    } catch {
    }
    applyResetCooldown();
  }
  function applyResetCooldown() {
    clearInterval(resetTimer);
    if (mode !== "forgot") {
      $("submitBtn").disabled = false;
      return;
    }
    const tick = () => {
      const left = resetUntil() - Date.now();
      if (mode !== "forgot" || left <= 0) {
        clearInterval(resetTimer);
        if (mode === "forgot") {
          $("submitBtn").disabled = false;
          $("submitBtn").textContent = "Send reset link";
        }
        return;
      }
      const sec = Math.ceil(left / 1e3);
      $("submitBtn").disabled = true;
      $("submitBtn").textContent = `Send again in ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    };
    tick();
    resetTimer = setInterval(tick, 1e3);
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
    if (mode === "forgot" && resetUntil() > Date.now()) setStatus("A reset link was sent recently. Please check your inbox and spam folder; you can ask for another one when the timer ends.", "ok");
  };
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (debugUnlockClick()) return;
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
        setStatus(`An email with a password reset link has been sent to ${email}. It can take a few minutes; please also check your spam folder.`, "ok");
        startResetCooldown();
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
      applyResetCooldown();
    }
  });
  async function start() {
    render();
    if (DEV && sessionUnlocked()) setupDebugBox();
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
  var UNLOCK_WORD = "steffiroshan";
  var UNLOCK_CLICKS = 5;
  var unlockClicks = 0;
  function sessionUnlocked() {
    try {
      return sessionStorage.getItem("sst_debug_unlocked") === "1";
    } catch {
      return false;
    }
  }
  function debugUnlockClick() {
    if (!DEV || $("password").value !== UNLOCK_WORD) {
      unlockClicks = 0;
      return false;
    }
    unlockClicks++;
    if (unlockClicks < UNLOCK_CLICKS) {
      setStatus("Email or password is incorrect.", "error");
      return true;
    }
    unlockClicks = 0;
    try {
      sessionStorage.setItem("sst_debug_unlocked", "1");
    } catch {
    }
    $("password").value = "";
    setStatus("");
    setupDebugBox();
    return true;
  }
  function setupDebugBox() {
    if (document.querySelector(".debug-box")) return;
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
