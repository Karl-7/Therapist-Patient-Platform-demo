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
    constructor(api2, tokenResponse, audience) {
      this.token = null;
      this.api = api2;
      this.url = api2.apiURL;
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
          const api2 = apiInstance || new API(url, {});
          return new _User(api2, token, audience)._saveUserData(data, true);
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
      const details2 = user.tokenDetails();
      if (details2?.expires_at) {
        const nowS2 = Math.floor(Date.now() / 1e3);
        const expiresAtS = typeof details2.expires_at === "number" && details2.expires_at > 1e12 ? Math.floor(details2.expires_at / 1e3) : details2.expires_at;
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

  // netlify/lib/default-affirmations.mjs
  var DEFAULT_AFFIRMATIONS = [
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
  var DEBUG_PRIVATE = { id: "debug-private", email: DEBUG_EMAIL, name: "Debug Private", createdAt: "2026-01-01T00:00:00.000Z" };
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
  var clone = (x) => JSON.parse(JSON.stringify(x));
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
  function devSignOut() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
    }
  }
  var isDoctor = (u) => u?.roles?.includes("doctor");
  var weekOf = (iso) => {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  async function devApi(path, { method = "GET", body } = {}) {
    const url = new URL(path, "http://dev.local");
    const route = url.pathname;
    const id = url.searchParams.get("id");
    const user = devCurrentUser();
    const db = loadDb();
    if (route === "/api/affirmations") {
      if (method === "GET") return { items: clone(db.affirmations?.items ?? DEFAULT_AFFIRMATIONS), updated: db.affirmations?.updated ?? null, isDefault: !db.affirmations };
      if (!user) throw fail(401, "Please sign in.");
      if (!isDoctor(user)) throw fail(403, "Doctor access only.");
      const items = (body?.items || []).filter((x) => x?.text?.trim()).map((x, i) => ({
        id: x.id || "a" + Date.now().toString(36) + i,
        category: (x.category || "General").trim(),
        tags: (x.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
        text: x.text.trim()
      }));
      db.affirmations = { items, updated: (/* @__PURE__ */ new Date()).toISOString(), updatedBy: user.email };
      saveDb(db);
      return clone(db.affirmations);
    }
    if (!user) throw fail(401, "Please sign in.");
    if (route === "/api/journals") {
      if (isDoctor(user)) throw fail(403, "Doctor accounts do not keep a journal.");
      const mine = db.journals.filter((e) => e.userId === user.id);
      if (method === "GET") return { entries: clone(mine).sort((a, b) => b.created.localeCompare(a.created)) };
      if (method === "POST") {
        if (!body?.text?.trim()) throw fail(400, "Write a little note before saving.");
        const created = body.created || (/* @__PURE__ */ new Date()).toISOString();
        const entry2 = { id: newId(), userId: user.id, title: (body.title || "").trim(), text: body.text.trim(), shared: body.shared === true, created, week: body.week || weekOf(created) };
        db.journals.push(entry2);
        saveDb(db);
        return { entry: clone(entry2) };
      }
      const entry = mine.find((e) => e.id === id);
      if (!entry) throw fail(404, "Entry not found");
      if (method === "PATCH") {
        if (typeof body?.shared === "boolean") entry.shared = body.shared;
        if (typeof body?.title === "string") entry.title = body.title.trim();
        if (body?.text?.trim()) entry.text = body.text.trim();
        entry.updated = (/* @__PURE__ */ new Date()).toISOString();
        saveDb(db);
        return { entry: clone(entry) };
      }
      if (method === "DELETE") {
        db.journals = db.journals.filter((e) => e !== entry);
        saveDb(db);
        return { ok: true };
      }
    }
    if (route === "/api/bookings") {
      if (method === "POST") {
        if (!body?.name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body?.email || "")) throw fail(400, "Please add your name and a valid email.");
        const booking = { id: newId(), userId: user.id, accountEmail: user.email, name: body.name.trim(), email: body.email.trim(), session: body.session || "", date: body.date || "", message: (body.message || "").trim(), status: "new", note: "", created: (/* @__PURE__ */ new Date()).toISOString() };
        db.bookings.push(booking);
        saveDb(db);
        return { booking: { id: booking.id, created: booking.created } };
      }
      if (!isDoctor(user)) throw fail(403, "Doctor access only.");
      if (method === "GET") return { bookings: clone(db.bookings).sort((a, b) => b.created.localeCompare(a.created)) };
      if (method === "PATCH") {
        const b = db.bookings.find((x) => x.id === id);
        if (!b) throw fail(404, "Booking not found");
        if (["new", "contacted", "scheduled", "closed"].includes(body?.status)) b.status = body.status;
        if (typeof body?.note === "string") b.note = body.note;
        b.updated = (/* @__PURE__ */ new Date()).toISOString();
        saveDb(db);
        return { booking: clone(b) };
      }
    }
    if (route.startsWith("/api/doctor/clients")) {
      if (!isDoctor(user)) throw fail(403, "Doctor access only.");
      const people = [DEBUG_PRIVATE, ...db.accounts.map(({ id: pid, email, name, createdAt }) => ({ id: pid, email, name, createdAt }))];
      const clientId = decodeURIComponent(route.split("/")[4] || "");
      if (!clientId) return { clients: clone(people) };
      const client = people.find((p) => p.id === clientId);
      if (!client) throw fail(404, "Not found");
      const weeks = /* @__PURE__ */ new Map();
      const slot = (w) => weeks.get(w) || weeks.set(w, { week: w, summary: null, shared: [] }).get(w);
      db.summaries.filter((s) => s.userId === clientId).forEach((s) => slot(s.week).summary = s);
      db.journals.filter((e) => e.userId === clientId && e.shared).forEach(({ id: eid, title, text, created, week }) => slot(week).shared.push({ id: eid, title, text, created, week }));
      const list = [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week));
      list.forEach((w) => w.shared.sort((a, b) => a.created.localeCompare(b.created)));
      return clone({ client, weeks: list });
    }
    throw fail(405, "Method not allowed");
  }
  function devAddSampleSummary(userId) {
    const db = loadDb();
    const week = weekOf((/* @__PURE__ */ new Date()).toISOString());
    const count = db.journals.filter((e) => e.userId === userId && e.week === week).length;
    db.summaries = db.summaries.filter((s) => !(s.userId === userId && s.week === week));
    db.summaries.push({
      userId,
      week,
      entryCount: count,
      summary: `(Sample text, written by debug mode, not by AI.) ${count} ${count === 1 ? "entry" : "entries"} this week.`,
      comparison: "Your AI service will compare this week with the previous one here.",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    saveDb(db);
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
  var isDoctor2 = (user) => Array.isArray(user?.roles) && user.roles.includes(DOCTOR_ROLE);
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
  async function signOut() {
    if (DEV) return devSignOut();
    setRemember(false);
    try {
      await logout();
    } catch {
    }
  }
  var loginUrl = (as, reason) => {
    const p = new URLSearchParams({ as });
    const here = location.pathname.split("/").pop() || "index.html";
    if (as === "private" && here !== "login.html") p.set("next", here);
    if (reason) p.set("reason", reason);
    return "login.html?" + p;
  };
  async function api(path, { method = "GET", body } = {}) {
    if (DEV) return devApi(path, { method, body });
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : void 0
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // assets/doctor-demo.js
  var monday = (weeksAgo) => {
    const d = /* @__PURE__ */ new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7 - weeksAgo * 7);
    return d;
  };
  var ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  var at = (weeksAgo, dayOffset, hour) => {
    const d = monday(weeksAgo);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 15);
    return d.toISOString();
  };
  var bookings = [
    { id: "b1", name: "Alex Morgan", email: "alex@example.com", session: "Online session", date: ymd(monday(-1)), message: "I would like to talk about work stress. Evenings suit me best.", status: "new", note: "", created: at(0, 1, 9) },
    { id: "b2", name: "Sam Lee", email: "sam@example.com", session: "Individual session", date: "", message: "", status: "contacted", note: "Sent available times on Monday.", created: at(1, 3, 14) },
    { id: "b3", name: "Jordan Kim", email: "jordan@example.com", session: "I'd like to discuss options", date: ymd(monday(-2)), message: "Looking for ADHD support for my teenager.", status: "scheduled", note: "First session booked.", created: at(2, 2, 11) }
  ];
  var clients = [
    { id: "c1", name: "Alex Morgan", email: "alex@example.com", createdAt: at(3, 0, 10) },
    { id: "c2", name: "", email: "river@example.com", createdAt: at(1, 4, 18) }
  ];
  var details = {
    c1: {
      client: clients[0],
      weeks: [
        {
          week: ymd(monday(1)),
          summary: {
            week: ymd(monday(1)),
            entryCount: 5,
            summary: "Wrote on five days. Early in the week the entries focus on pressure at work and trouble sleeping. From Thursday the tone becomes calmer; they mention a walk with a friend and using a breathing exercise before bed.",
            comparison: "Compared with last week: fewer mentions of feeling overwhelmed (2 vs 5) and sleep described as slightly better. Work stress remains the main theme.",
            generatedAt: at(1, 6, 20)
          },
          shared: [
            { id: "e5", title: "A better day", text: "Went for a long walk with Maya after work. I noticed I was breathing more slowly afterwards. I want to keep doing this.", created: at(1, 4, 21), week: ymd(monday(1)) }
          ]
        },
        {
          week: ymd(monday(2)),
          summary: {
            week: ymd(monday(2)),
            entryCount: 4,
            summary: "Four entries, mostly about deadlines, feeling behind and waking up at night. One entry mentions skipping meals on busy days.",
            comparison: "First week with entries, so there is nothing to compare yet.",
            generatedAt: at(2, 6, 20)
          },
          shared: []
        }
      ]
    },
    c2: { client: clients[1], weeks: [{ week: ymd(monday(0)), summary: null, shared: [{ id: "e9", title: "", text: "First time writing here. Not sure what to say yet, but it feels good to start.", created: at(0, 2, 22), week: ymd(monday(0)) }] }] }
  };
  var affirmations = null;
  var clone2 = (x) => JSON.parse(JSON.stringify(x));
  async function demoApi(path, { method = "GET", body } = {}) {
    await new Promise((r) => setTimeout(r, 150));
    const url = new URL(path, location.origin);
    if (url.pathname === "/api/bookings") {
      if (method === "PATCH") {
        const b = bookings.find((x) => x.id === url.searchParams.get("id"));
        Object.assign(b, body);
        return { booking: clone2(b) };
      }
      return { bookings: clone2(bookings) };
    }
    if (url.pathname === "/api/doctor/clients") return { clients: clone2(clients) };
    if (url.pathname.startsWith("/api/doctor/clients/")) return clone2(details[url.pathname.split("/").pop()]);
    if (url.pathname === "/api/affirmations") {
      if (method === "PUT") {
        affirmations = clone2(body.items);
        return { items: clone2(affirmations), updated: (/* @__PURE__ */ new Date()).toISOString() };
      }
      if (!affirmations) {
        affirmations = [
          { id: "a1", category: "Stress & Anxiety", tags: ["anxious", "calm", "breathing"], text: "I can take one slow breath at a time. I do not have to solve everything right now." },
          { id: "a4", category: "Self-Compassion", tags: ["sad", "kindness", "gentle"], text: "It is okay to feel what I feel. I can meet myself with kindness today." },
          { id: "a6", category: "Mindfulness", tags: ["present", "mindful", "now"], text: "I can return to this moment, gently, without needing to change anything." }
        ];
      }
      return { items: clone2(affirmations), updated: null, isDefault: true };
    }
    throw new Error("Not available in the preview");
  }

  // assets/doctor.js
  var $ = (id) => document.getElementById(id);
  var el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids.filter((k) => k !== null && k !== void 0 && k !== false));
    return node;
  };
  var DEMO = new URLSearchParams(location.search).has("demo");
  var call = DEMO ? demoApi : api;
  var fmtDate = (iso, opts = { dateStyle: "medium", timeStyle: "short" }) => iso ? new Date(iso).toLocaleString(void 0, opts) : "";
  function weekLabel(monday2) {
    const start2 = /* @__PURE__ */ new Date(monday2 + "T00:00:00");
    const end = new Date(start2);
    end.setDate(end.getDate() + 6);
    const o = { month: "short", day: "numeric" };
    return `Week of ${start2.toLocaleDateString(void 0, o)} \u2013 ${end.toLocaleDateString(void 0, { ...o, year: "numeric" })}`;
  }
  function onError(err, target) {
    if (err?.status === 401) return location.replace(loginUrl("doctor", "expired"));
    if (err?.status === 403) return location.replace(loginUrl("doctor", "not-doctor"));
    if (target) {
      target.innerHTML = "";
      target.append(el("p", { className: "empty", textContent: err?.message || "Something went wrong." }));
    }
  }
  var loaded = {};
  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    ["bookings", "clients", "affirmations"].forEach((t) => $("tab-" + t).classList.toggle("hidden", t !== name));
    if (!loaded[name]) {
      loaded[name] = true;
      ({ bookings: loadBookings, clients: loadClients, affirmations: loadAffirmations })[name]();
    }
    try {
      sessionStorage.setItem("sst_doctor_tab", name);
    } catch {
    }
  }
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => showTab(b.dataset.tab));
  var STATUSES = ["new", "contacted", "scheduled", "closed"];
  var bookings2 = [];
  var statusFilter = "open";
  async function loadBookings() {
    try {
      bookings2 = (await call("/api/bookings")).bookings;
      renderBookings();
    } catch (err) {
      onError(err, $("bookingList"));
    }
  }
  function renderBookings() {
    const newCount = bookings2.filter((b) => b.status === "new").length;
    $("newCount").textContent = newCount;
    $("newCount").classList.toggle("hidden", !newCount);
    const filters = [["open", "Open"], ["all", "All"], ...STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)])];
    $("statusFilter").innerHTML = "";
    filters.forEach(([key, label]) => {
      const b = el("button", { className: "chip" + (statusFilter === key ? " active" : ""), type: "button", textContent: label });
      b.onclick = () => {
        statusFilter = key;
        renderBookings();
      };
      $("statusFilter").append(b);
    });
    const shown = bookings2.filter((b) => statusFilter === "all" || (statusFilter === "open" ? b.status !== "closed" : b.status === statusFilter));
    const list = $("bookingList");
    list.innerHTML = "";
    if (!shown.length) return list.append(el("p", { className: "empty", textContent: bookings2.length ? "Nothing in this view." : "No enquiries yet." }));
    shown.forEach((b) => {
      const status = el("select", { className: "field", ariaLabel: "Status" }, ...STATUSES.map((s) => el("option", { value: s, textContent: s[0].toUpperCase() + s.slice(1), selected: s === b.status })));
      const note = el("textarea", { className: "field", placeholder: "Private note (only doctors see this)", value: b.note || "", ariaLabel: "Note" });
      const saved = el("span", { className: "notice" });
      const save = async (patch) => {
        saved.textContent = "Saving\u2026";
        try {
          Object.assign(b, (await call(`/api/bookings?id=${encodeURIComponent(b.id)}`, { method: "PATCH", body: patch })).booking);
          saved.textContent = "Saved";
          if (patch.status) renderBookings();
        } catch (err) {
          saved.textContent = err.message;
          onError(err);
        }
      };
      status.onchange = () => save({ status: status.value });
      note.onchange = () => save({ note: note.value });
      const replyHref = `mailto:${encodeURIComponent(b.email)}?subject=${encodeURIComponent("Your Safe Space Therapy enquiry")}`;
      list.append(el(
        "article",
        { className: "booking" },
        el(
          "div",
          {},
          el("h3", {}, b.name, el("span", { className: "pill " + b.status, textContent: b.status })),
          el(
            "div",
            { className: "meta" },
            el("a", { href: replyHref, textContent: b.email }),
            ` \xB7 ${b.session || "Session not chosen"} \xB7 Preferred date: ${b.date ? fmtDate(b.date + "T00:00:00", { dateStyle: "medium" }) : "not given"}`
          ),
          el("div", { className: "meta", textContent: "Sent " + fmtDate(b.created) }),
          b.message ? el("p", { textContent: b.message }) : el("p", { className: "meta", textContent: "No message." })
        ),
        el("div", {}, el("label", { className: "meta", textContent: "Status" }), status, note, saved)
      ));
    });
  }
  var clients2 = [];
  var activeClient = null;
  async function loadClients() {
    try {
      clients2 = (await call("/api/doctor/clients")).clients;
      renderClientList();
    } catch (err) {
      onError(err, $("clientList"));
    }
  }
  $("clientSearch").oninput = () => renderClientList();
  function renderClientList() {
    const q = $("clientSearch").value.trim().toLowerCase();
    const list = $("clientList");
    list.innerHTML = "";
    const shown = clients2.filter((c) => !q || `${c.name} ${c.email}`.toLowerCase().includes(q));
    if (!shown.length) return list.append(el("p", { className: "empty", textContent: clients2.length ? "No match." : "No Private accounts yet." }));
    shown.forEach((c) => {
      const b = el("button", { type: "button" }, c.name || c.email, el("small", { textContent: c.name ? c.email : "Joined " + fmtDate(c.createdAt, { dateStyle: "medium" }) }));
      b.setAttribute("aria-current", String(c.id === activeClient));
      b.onclick = () => openClient(c.id);
      list.append(b);
    });
  }
  async function openClient(id) {
    activeClient = id;
    renderClientList();
    const box = $("clientDetail");
    box.innerHTML = '<p class="empty">Loading\u2026</p>';
    try {
      const { client, weeks } = await call(`/api/doctor/clients/${encodeURIComponent(id)}`);
      if (activeClient !== id) return;
      box.innerHTML = "";
      box.append(
        el("h3", { textContent: client.name || client.email, style: "margin:0;font-size:20px" }),
        el("div", { className: "meta", textContent: `${client.email}${client.createdAt ? " \xB7 joined " + fmtDate(client.createdAt, { dateStyle: "medium" }) : ""}` })
      );
      if (DEV && !DEMO) {
        const sample = el("button", { className: "btn secondary small", type: "button", textContent: "Debug: add sample AI summary for this week", style: "margin-top:10px" });
        sample.onclick = () => {
          devAddSampleSummary(id);
          openClient(id);
        };
        box.append(sample);
      }
      if (!weeks.length) {
        box.append(el("p", { className: "empty", textContent: "No weekly summaries or shared entries yet." }));
        return;
      }
      weeks.forEach((w) => box.append(renderWeek(w)));
      if (window.innerWidth < 800) box.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      onError(err, box);
    }
  }
  function renderWeek(w) {
    const s = w.summary;
    const ai = s ? el(
      "div",
      { className: "ai" },
      el("div", { className: "label", textContent: "AI WEEKLY SUMMARY" + (s.entryCount ? ` \xB7 ${s.entryCount} ${s.entryCount === 1 ? "entry" : "entries"}` : "") }),
      el("p", { textContent: s.summary || "" }),
      s.comparison ? el("div", { className: "compare" }, el("div", { className: "label", textContent: "COMPARED WITH THE PREVIOUS WEEK" }), el("p", { textContent: s.comparison })) : null,
      s.generatedAt ? el("div", { className: "notice", textContent: "Generated " + fmtDate(s.generatedAt) }) : null
    ) : el("div", { className: "ai missing", textContent: "The AI summary for this week has not been generated yet." });
    const shared = w.shared.length ? w.shared.map((e) => el(
      "div",
      { className: "entry" },
      el("strong", { textContent: e.title || "Reflection" }),
      el("span", { className: "meta", textContent: " \xB7 " + fmtDate(e.created, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }),
      el("p", { textContent: e.text })
    )) : [el("p", { className: "meta", textContent: "No entries shared this week.", style: "margin:12px 0 0" })];
    return el(
      "section",
      { className: "week" },
      el("h3", { textContent: weekLabel(w.week) }),
      ai,
      el("div", { className: "label meta", textContent: `Shared entries (${w.shared.length})`, style: "margin-top:14px;font-weight:700" }),
      ...shared
    );
  }
  var affirmations2 = [];
  var dirty = false;
  async function loadAffirmations() {
    try {
      const data = await call("/api/affirmations");
      affirmations2 = data.items.map((x) => ({ ...x, tags: [...x.tags || []] }));
      renderAffirmations();
      setAffStatus(data.isDefault ? "Showing the starter list. Save to make it yours." : "Last saved " + fmtDate(data.updated));
    } catch (err) {
      onError(err, $("affList"));
    }
  }
  function setAffStatus(text, kind = "") {
    $("affStatus").textContent = text;
    $("affStatus").className = "status" + (kind ? " " + kind : "");
  }
  function markDirty() {
    dirty = true;
    setAffStatus("Unsaved changes");
  }
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
  function renderAffirmations() {
    $("categoryOptions").innerHTML = "";
    [...new Set(affirmations2.map((a) => a.category).filter(Boolean))].forEach((c) => $("categoryOptions").append(el("option", { value: c })));
    const q = $("affSearch").value.trim().toLowerCase();
    const list = $("affList");
    list.innerHTML = "";
    const shown = affirmations2.filter((a) => !q || `${a.category} ${a.text} ${a.tags.join(" ")}`.toLowerCase().includes(q));
    if (!shown.length) return list.append(el("p", { className: "empty", textContent: "No affirmations here." }));
    shown.forEach((a) => {
      const cat = el("input", { className: "field", value: a.category, placeholder: "Category", ariaLabel: "Category" });
      cat.setAttribute("list", "categoryOptions");
      cat.oninput = () => {
        a.category = cat.value;
        markDirty();
      };
      const text = el("textarea", { className: "field aff-text", value: a.text, placeholder: "Write the affirmation\u2026", ariaLabel: "Affirmation text", rows: 2 });
      text.oninput = () => {
        a.text = text.value;
        markDirty();
      };
      const tags = el("input", { className: "field aff-tags", value: a.tags.join(", "), placeholder: "calm, breathing", ariaLabel: "Tags" });
      tags.oninput = () => {
        a.tags = tags.value.split(",").map((t) => t.trim()).filter(Boolean);
        markDirty();
      };
      const del = el("button", { className: "icon-btn", type: "button", textContent: "\u2715", title: "Remove", ariaLabel: "Remove affirmation" });
      del.onclick = () => {
        if (a.text && !confirm("Remove this affirmation?")) return;
        affirmations2 = affirmations2.filter((x) => x !== a);
        markDirty();
        renderAffirmations();
      };
      list.append(el("div", { className: "aff-row" }, cat, text, tags, del));
    });
  }
  $("affSearch").oninput = () => renderAffirmations();
  $("affAdd").onclick = () => {
    affirmations2.unshift({ id: "a" + Date.now().toString(36), category: "", text: "", tags: [] });
    $("affSearch").value = "";
    markDirty();
    renderAffirmations();
    $("affList").querySelector("textarea")?.focus();
  };
  $("affSave").onclick = async () => {
    const items = affirmations2.filter((a) => a.text.trim());
    $("affSave").disabled = true;
    setAffStatus("Saving\u2026");
    try {
      const saved = await call("/api/affirmations", { method: "PUT", body: { items } });
      affirmations2 = saved.items.map((x) => ({ ...x, tags: [...x.tags] }));
      dirty = false;
      renderAffirmations();
      setAffStatus(`Saved ${saved.items.length} affirmations. They are live on the site now.`, "ok");
    } catch (err) {
      setAffStatus(err.message, "error");
      onError(err);
    } finally {
      $("affSave").disabled = false;
    }
  };
  $("signOutBtn").onclick = async () => {
    if (DEMO) return location.replace("login.html?as=doctor");
    await signOut();
    location.replace(loginUrl("doctor", "signed-out"));
  };
  async function start() {
    let user;
    if (DEMO) {
      user = { name: "Dr. Sample", email: "doctor@example.com", roles: ["doctor"] };
      $("demoBanner").classList.remove("hidden");
    } else {
      user = await currentUser2().catch(() => null);
      if (!user) return location.replace(loginUrl("doctor"));
      if (!isDoctor2(user)) return location.replace(loginUrl("doctor", "not-doctor"));
    }
    $("who").textContent = user.name || user.email;
    document.documentElement.classList.remove("auth-pending");
    if (!DEMO) showDevBanner();
    let tab = "bookings";
    try {
      tab = sessionStorage.getItem("sst_doctor_tab") || tab;
    } catch {
    }
    showTab(["bookings", "clients", "affirmations"].includes(tab) ? tab : "bookings");
    if (tab !== "bookings") loadBookings();
  }
  start();
})();
