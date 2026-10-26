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
    const pickSome = (list, n) => [...list].sort(() => rand() - 0.5).slice(0, n);
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
        const monday2 = new Date(thisMonday);
        monday2.setDate(monday2.getDate() - 7 * (5 - i));
        const days = pickSome([0, 1, 2, 3, 4, 5, 6], 3 + Math.floor(rand() * 4)).sort((a, b) => a - b);
        const shared = new Set(pickSome(days, Math.min(days.length, 1 + Math.floor(rand() * 3))));
        days.forEach((day) => {
          const d = new Date(monday2);
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
      const at2 = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
      db.bookings.push(
        { id: newId2(), userId: "sample-lina", accountEmail: "lina@example.test", name: "Lina Karim", email: "lina@example.test", session: "Online session", date: "", message: "Evenings work best for me.", status: "new", note: "", created: at2(1) },
        { id: newId2(), userId: "sample-omar", accountEmail: "omar@example.test", name: "Omar Haddad", email: "omar@example.test", session: "Individual session", date: "", message: "", status: "contacted", note: "Offered Tuesday or Thursday.", created: at2(6) }
      );
    }
  }

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
  function weekOf(iso) {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
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
        db.queue[`${user.id}/${entry2.week}`] = Date.now();
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
        if (typeof body?.text === "string" || typeof body?.title === "string") db.queue[`${user.id}/${entry.week}`] = Date.now();
        saveDb(db);
        return { entry: clone(entry) };
      }
      if (method === "DELETE") {
        db.journals = db.journals.filter((e) => e !== entry);
        db.queue[`${user.id}/${entry.week}`] = Date.now();
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
    if (route.startsWith("/api/doctor/summaries/")) {
      if (!isDoctor(user)) throw fail(403, "Doctor access only.");
      if (route.endsWith("/refresh") && Object.keys(db.queue).length && !db.job) {
        db.job = { startedAt: Date.now() };
        saveDb(db);
      }
      return debugSummaryStatus(db, body?.clientId || url.searchParams.get("clientId"));
    }
    if (route.startsWith("/api/doctor/clients")) {
      if (!isDoctor(user)) throw fail(403, "Doctor access only.");
      const people = [DEBUG_PRIVATE, ...db.accounts.map(({ id: pid, email, name, createdAt }) => ({ id: pid, email, name, createdAt }))];
      const parts = route.split("/");
      const clientId = decodeURIComponent(parts[4] || "");
      if (!clientId) return { clients: clone(people) };
      db.notes || (db.notes = {});
      if (parts[5] === "notes" && method === "PUT") {
        db.notes[clientId] = { symptoms: String(body?.symptoms || ""), updated: (/* @__PURE__ */ new Date()).toISOString() };
        saveDb(db);
        return { notes: clone(db.notes[clientId]) };
      }
      const client = people.find((p) => p.id === clientId);
      if (!client) throw fail(404, "Not found");
      const waiting = new Set(Object.keys(db.queue).filter((k) => k.startsWith(clientId + "/")).map((k) => k.split("/")[1]));
      const weeks = /* @__PURE__ */ new Map();
      const slot = (w) => weeks.get(w) || weeks.set(w, { week: w, summary: null, shared: [], waiting: waiting.has(w) }).get(w);
      db.summaries.filter((s) => s.userId === clientId).forEach((s) => slot(s.week).summary = s);
      db.journals.filter((e) => e.userId === clientId && e.shared).forEach(({ id: eid, title, text, created, week }) => slot(week).shared.push({ id: eid, title, text, created, week }));
      waiting.forEach((w) => slot(w));
      const list = [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week));
      list.forEach((w) => w.shared.sort((a, b) => a.created.localeCompare(b.created)));
      return clone({ client, weeks: list, notes: db.notes[clientId] || { symptoms: "" } });
    }
    throw fail(405, "Method not allowed");
  }
  var DEBUG_RUN_MS = 4e3;
  function runDebugSummaries(db) {
    const minus = (week, n) => {
      const d = /* @__PURE__ */ new Date(week + "T00:00:00");
      d.setDate(d.getDate() - 7 * n);
      return weekOf(d.toISOString());
    };
    Object.keys(db.queue).sort((a, b) => a.split("/")[1].localeCompare(b.split("/")[1])).forEach((key) => {
      const [userId, week] = key.split("/");
      const entries = db.journals.filter((e) => e.userId === userId && e.week === week);
      db.summaries = db.summaries.filter((s) => !(s.userId === userId && s.week === week));
      if (!entries.length) return;
      const earlier = [1, 2, 3].map((n) => db.summaries.find((s) => s.userId === userId && s.week === minus(week, n))).filter(Boolean);
      const text = entries.map((e) => e.text).join(" ");
      const count = (re) => (text.match(re) || []).length;
      const mood = Math.max(1, Math.min(10, 5 + 2 * count(/calm|good|better|happy|fine|جيد/gi) - 2 * count(/sad|angry|mad|anxious|tired|low|غاضب/gi)));
      db.summaries.push({
        userId,
        week,
        entryCount: entries.length,
        model: "debug",
        mood,
        summary: `(Debug sample, not real AI.) ${entries.length} ${entries.length === 1 ? "entry" : "entries"} this week. The real summary of up to 100 words will come from Qwen on your AWS server.`,
        comparison: earlier.length ? `Mood ${mood}/10 vs ${earlier[0].mood}/10 the week before (sample text).` : "First week with entries.",
        changes: earlier.length ? [
          `Mood ${mood >= earlier[0].mood ? "up" : "down"} from ${earlier[0].mood} to ${mood} (sample).`,
          `${entries.length} entries this week vs ${Math.round(earlier.reduce((a, s) => a + s.entryCount, 0) / earlier.length)} on average before (sample).`
        ] : [],
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    db.queue = {};
  }
  function debugSummaryStatus(db, clientId) {
    if (db.job && Date.now() - db.job.startedAt > DEBUG_RUN_MS) {
      runDebugSummaries(db);
      db.job = null;
      saveDb(db);
    }
    const keys = Object.keys(db.queue);
    return {
      state: db.job ? Date.now() - db.job.startedAt < DEBUG_RUN_MS / 2 ? "starting" : "running" : keys.length ? "waiting" : "idle",
      pending: keys.length,
      pendingForClient: clientId ? keys.filter((k) => k.startsWith(clientId + "/")).length : void 0
    };
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
  var ALEX_WEEKS = [
    { ago: 6, mood: 4, summary: "Wrote about feeling behind at work and waking up at night. Mentions skipping lunch on busy days and feeling irritable with family.", comparison: "First week with entries." },
    { ago: 5, mood: 3, summary: "A hard week. Several entries about deadlines, poor sleep and feeling alone with the workload. One entry mentions crying after a meeting.", comparison: "Lower mood than the week before; sleep described as worse." },
    { ago: 4, mood: 5, summary: "Mixed week. Work stress continues but they describe a good weekend with a friend and trying a breathing exercise before bed.", comparison: "Somewhat better; first mention of a coping strategy." },
    { ago: 3, mood: 6, summary: "Steadier. Talks about setting a limit on evening emails and sleeping a little better. Still worried about an upcoming review.", comparison: "Improvement continues; fewer entries about sleep." },
    { ago: 2, mood: 5, summary: "The performance review went less well than hoped. Frustration and self-criticism, but they also note reaching out to a colleague for support.", comparison: "A small dip after the review, but less overwhelmed than four weeks ago." },
    { ago: 1, mood: 7, summary: "Calmer week. Long walks, dinner with a friend, and using the breathing exercise most nights. Work is still busy but described as manageable.", comparison: "Best week so far; sleep and mood both described as better." }
  ];
  var alexWeeks = ALEX_WEEKS.map((w) => ({
    week: ymd(monday(w.ago)),
    waiting: false,
    summary: {
      week: ymd(monday(w.ago)),
      mood: w.mood,
      summary: w.summary,
      comparison: w.comparison,
      entryCount: 4 + w.ago % 3,
      generatedAt: at(w.ago, 6, 20),
      changes: w.ago === 1 ? [
        "Mood highest so far (7/10), up from 5\u20136 in the previous three weeks.",
        "Sleep described as better on most nights; no night waking mentioned.",
        "Uses the breathing exercise regularly now, not just occasionally.",
        "Work stress still present but no longer the main theme."
      ] : []
    },
    shared: w.ago === 1 ? [
      { id: "e1", title: "Monday", text: "Long walk after work. I noticed I was breathing more slowly afterwards.", created: at(1, 0, 21), week: ymd(monday(1)) },
      { id: "e2", title: "", text: "Dinner with Maya. Laughed a lot. Felt like myself again.", created: at(1, 3, 22), week: ymd(monday(1)) },
      { id: "e3", title: "Sunday", text: "Did the breathing exercise before bed five nights this week.", created: at(1, 6, 19), week: ymd(monday(1)) }
    ] : w.ago === 3 ? [
      { id: "e4", title: "", text: "Turned off email after 7pm. Slept better.", created: at(3, 2, 21), week: ymd(monday(3)) }
    ] : []
  })).reverse();
  var notes = { c1: { symptoms: "Work-related stress and insomnia (since spring). No previous therapy.\nFollow up: sleep routine, boundaries at work.", updated: at(2, 1, 10) }, c2: { symptoms: "" } };
  var details = {
    c1: { client: clients[0], weeks: [{ week: ymd(monday(0)), waiting: true, summary: null, shared: [] }, ...alexWeeks] },
    c2: { client: clients[1], weeks: [{ week: ymd(monday(0)), waiting: true, summary: null, shared: [{ id: "e9", title: "", text: "First time writing here. Not sure what to say yet, but it feels good to start.", created: at(0, 2, 22), week: ymd(monday(0)) }] }] }
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
    if (url.pathname.startsWith("/api/doctor/clients/")) {
      const [, , , , id, sub] = url.pathname.split("/");
      if (sub === "notes") {
        notes[id] = { symptoms: body?.symptoms || "", updated: (/* @__PURE__ */ new Date()).toISOString() };
        return { notes: clone2(notes[id]) };
      }
      return clone2({ ...details[id], notes: notes[id] });
    }
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
  var detail = null;
  var openWeek = null;
  async function openClient(id, { keepView = false } = {}) {
    if (activeClient !== id) openWeek = null;
    activeClient = id;
    renderClientList();
    const box = $("clientDetail");
    if (!keepView) {
      openWeek = null;
      box.innerHTML = '<p class="empty">Loading\u2026</p>';
    }
    try {
      const data = await call(`/api/doctor/clients/${encodeURIComponent(id)}`);
      if (activeClient !== id) return;
      detail = data;
      renderDetail();
      if (!keepView && window.innerWidth < 800) box.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      onError(err, box);
    }
    if (!keepView) checkSummaries(id);
  }
  var weekRange = (monday2, withYear = true) => {
    const start2 = /* @__PURE__ */ new Date(monday2 + "T00:00:00");
    const end = new Date(start2);
    end.setDate(end.getDate() + 6);
    const o = { day: "numeric", month: "short" };
    return `${start2.toLocaleDateString(void 0, o)} \u2013 ${end.toLocaleDateString(void 0, withYear ? { ...o, year: "numeric" } : o)}`;
  };
  function renderDetail() {
    const box = $("clientDetail");
    const { client, weeks, notes: notes2 } = detail;
    box.innerHTML = "";
    const summarize = el("button", { className: "btn small", type: "button", id: "summarizeBtn", textContent: "Summarize recent journals" });
    summarize.onclick = () => startSummaries(client.id);
    const symptomsBtn = el("button", { className: "btn secondary small", type: "button", textContent: notes2?.symptoms ? "Symptoms \u2022" : "Symptoms" });
    symptomsBtn.setAttribute("aria-expanded", "false");
    const symptoms = renderSymptoms(client.id, notes2, symptomsBtn);
    symptomsBtn.onclick = () => {
      const open = symptoms.classList.toggle("hidden") === false;
      symptomsBtn.setAttribute("aria-expanded", String(open));
      if (open) symptoms.querySelector("textarea").focus();
    };
    box.append(
      el(
        "div",
        { className: "client-head" },
        el(
          "div",
          {},
          el("h3", { textContent: client.name || client.email }),
          el("div", { className: "meta", textContent: `${client.email}${client.createdAt ? " \xB7 joined " + fmtDate(client.createdAt, { dateStyle: "medium" }) : ""}` })
        ),
        el("div", { className: "client-actions" }, summarize, symptomsBtn)
      ),
      symptoms,
      summaryBar
    );
    applySummaryState();
    if (openWeek) {
      const w = weeks.find((x) => x.week === openWeek);
      if (w) return box.append(renderWeekPage(w));
      openWeek = null;
    }
    const summarized = weeks.filter((w) => w.summary);
    if (!weeks.length) return box.append(el("p", { className: "empty", textContent: "No journal entries yet." }));
    const latest = summarized[0];
    const changes = latest?.summary?.changes || [];
    box.append(el(
      "section",
      { className: "panel-box changes" },
      el("h4", { textContent: "What changed recently" }),
      el("p", { className: "meta", textContent: latest ? `Week of ${weekRange(latest.week)} compared with the three weeks before` : "Not summarized yet" }),
      changes.length ? el("ul", {}, ...changes.map((c) => el("li", { textContent: c }))) : el("p", { className: "meta", textContent: latest ? "Shown once at least two weeks are summarized." : "Press \u201CSummarize recent journals\u201D to create the first summaries." })
    ));
    box.append(renderMoodChart(summarized.filter((w) => Number.isFinite(w.summary.mood)).map((w) => ({ week: w.week, mood: w.summary.mood })).reverse()));
    const list = el("div", { className: "week-list" });
    weeks.forEach((w) => {
      const s = w.summary;
      const card = el(
        "button",
        { type: "button", className: "week-card" },
        el("span", { className: "week-date", textContent: `Week of ${weekRange(w.week)}` }),
        s ? el("span", { className: "week-summary", textContent: s.summary }) : el("span", { className: "week-summary muted", textContent: "Not summarized yet." }),
        s?.comparison ? el("span", { className: "week-compare", textContent: "Compared with the week before: " + s.comparison }) : null,
        el("span", { className: "week-foot", textContent: `${w.shared.length} shared ${w.shared.length === 1 ? "entry" : "entries"}${s && w.waiting ? " \xB7 new writing since this summary" : ""} \u203A` })
      );
      card.onclick = () => {
        openWeek = w.week;
        renderDetail();
        $("clientDetail").scrollIntoView({ behavior: "smooth", block: "start" });
      };
      list.append(card);
    });
    box.append(list);
  }
  function renderSymptoms(clientId, notes2, button) {
    const area = el("textarea", { className: "field", value: notes2?.symptoms || "", placeholder: "Presenting symptoms, background, things to follow up\u2026", ariaLabel: "Symptoms and notes" });
    const saved = el("span", { className: "meta", textContent: notes2?.updated ? "Saved " + fmtDate(notes2.updated) : "Only doctors can see this." });
    let timer = null;
    const save = async () => {
      clearTimeout(timer);
      saved.textContent = "Saving\u2026";
      try {
        const res = await call(`/api/doctor/clients/${encodeURIComponent(clientId)}/notes`, { method: "PUT", body: { symptoms: area.value } });
        detail.notes = res.notes;
        saved.textContent = "Saved " + fmtDate(res.notes.updated);
        button.textContent = area.value.trim() ? "Symptoms \u2022" : "Symptoms";
      } catch (err) {
        saved.textContent = "Not saved: " + err.message;
        onError(err);
      }
    };
    area.oninput = () => {
      saved.textContent = "Editing\u2026";
      clearTimeout(timer);
      timer = setTimeout(save, 900);
    };
    area.onblur = () => timer && save();
    return el("div", { className: "symptoms hidden" }, el("label", { className: "symptoms-label", textContent: "Symptoms" }), area, saved);
  }
  function renderWeekPage(w) {
    const back = el("button", { type: "button", className: "linkish", textContent: "\u2190 All weeks" });
    back.onclick = () => {
      openWeek = null;
      renderDetail();
    };
    const s = w.summary;
    const page = el(
      "section",
      { className: "week-page" },
      back,
      el("h4", { className: "week-date big", textContent: `Week of ${weekRange(w.week)}` }),
      s ? el(
        "div",
        { className: "ai" },
        el("div", { className: "label", textContent: `AI WEEKLY SUMMARY${Number.isFinite(s.mood) ? ` \xB7 MOOD ${s.mood}/10` : ""}` }),
        el("p", { textContent: s.summary }),
        s.comparison ? el("div", { className: "compare" }, el("div", { className: "label", textContent: "COMPARED WITH THE WEEK BEFORE" }), el("p", { textContent: s.comparison })) : null
      ) : el("div", { className: "ai missing", textContent: "This week is not summarized yet." }),
      el("h4", { className: "shared-title", textContent: "Entries shared with you" })
    );
    if (!w.shared.length) {
      page.append(el("p", { className: "meta", textContent: "No entries were shared this week." }));
      return page;
    }
    const byDay = /* @__PURE__ */ new Map();
    w.shared.forEach((e) => {
      const d = new Date(e.created);
      const key = d.toDateString();
      if (!byDay.has(key)) byDay.set(key, { date: d, items: [] });
      byDay.get(key).items.push(e);
    });
    [...byDay.values()].sort((a, b) => a.date - b.date).forEach(({ date, items }) => {
      page.append(el(
        "div",
        { className: "day" },
        el("div", { className: "day-name", textContent: date.toLocaleDateString(void 0, { weekday: "long", day: "numeric", month: "short" }) }),
        ...items.map((e) => el("div", { className: "day-entry", dir: "auto" }, e.title ? el("div", { className: "day-entry-title", textContent: e.title, dir: "auto" }) : null, el("p", { textContent: e.text, dir: "auto" })))
      ));
    });
    return page;
  }
  function renderMoodChart(points) {
    const wrap = el(
      "section",
      { className: "panel-box mood" },
      el("h4", { textContent: "Mood by week" }),
      el("p", { className: "meta", textContent: "AI estimate from everything the person wrote that week \xB7 1 = very low, 10 = very good" })
    );
    if (!points.length) {
      wrap.append(el("p", { className: "meta", textContent: "No summarized weeks yet." }));
      return wrap;
    }
    const plot = el("div", { className: "mood-plot" });
    const tip = el("div", { className: "mood-tip hidden", role: "status" });
    plot.append(tip);
    const table = el(
      "table",
      { className: "sr-only" },
      el("caption", { textContent: "Mood by week" }),
      el("tr", {}, el("th", { textContent: "Week" }), el("th", { textContent: "Mood (1\u201310)" })),
      ...points.map((p) => el("tr", {}, el("td", { textContent: weekRange(p.week) }), el("td", { textContent: String(p.mood) })))
    );
    wrap.append(plot, table);
    const NS = "http://www.w3.org/2000/svg";
    const svgEl = (tag, attrs = {}) => {
      const n = document.createElementNS(NS, tag);
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      return n;
    };
    const draw = () => {
      const W = Math.max(260, plot.clientWidth || 600);
      const H = 190;
      const pad = { l: 30, r: 16, t: 12, b: 28 };
      const x = (i) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : i * (W - pad.l - pad.r) / (points.length - 1));
      const y = (v) => pad.t + (10 - v) * (H - pad.t - pad.b) / 9;
      plot.querySelector("svg")?.remove();
      const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Mood by week, ${points.length} weeks, latest ${points[points.length - 1].mood} out of 10` });
      [1, 4, 7, 10].forEach((v) => {
        svg.append(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "grid" }));
        const t = svgEl("text", { x: pad.l - 8, y: y(v) + 4, class: "axis", "text-anchor": "end" });
        t.textContent = v;
        svg.append(t);
      });
      const last = points[points.length - 1];
      const xl = svgEl("text", { x: x(points.length - 1), y: H - 8, class: "axis", "text-anchor": points.length === 1 ? "middle" : "end" });
      xl.textContent = (/* @__PURE__ */ new Date(last.week + "T00:00:00")).toLocaleDateString(void 0, { day: "numeric", month: "short", year: "numeric" });
      svg.append(xl);
      if (points.length > 1) svg.append(svgEl("polyline", { points: points.map((p, i) => `${x(i)},${y(p.mood)}`).join(" "), class: "line" }));
      const cross = svgEl("line", { y1: pad.t, y2: H - pad.b, class: "cross", visibility: "hidden" });
      svg.append(cross);
      const dots = points.map((p, i) => {
        const c = svgEl("circle", { cx: x(i), cy: y(p.mood), r: 4.5, class: "dot" });
        svg.append(c);
        return c;
      });
      const hit = svgEl("rect", { x: pad.l - 10, y: 0, width: W - pad.l - pad.r + 20, height: H, fill: "transparent" });
      const show = (evt) => {
        const r = svg.getBoundingClientRect();
        const px = evt.clientX - r.left;
        let i = 0;
        points.forEach((_, k) => {
          if (Math.abs(x(k) - px) < Math.abs(x(i) - px)) i = k;
        });
        cross.setAttribute("x1", x(i));
        cross.setAttribute("x2", x(i));
        cross.setAttribute("visibility", "visible");
        dots.forEach((d, k) => d.setAttribute("r", k === i ? 6 : 4.5));
        tip.textContent = `Week of ${weekRange(points[i].week, false)} \xB7 mood ${points[i].mood}/10`;
        tip.classList.remove("hidden");
        tip.style.left = Math.min(Math.max(x(i) - tip.offsetWidth / 2, 0), W - tip.offsetWidth) + "px";
        tip.style.top = Math.max(y(points[i].mood) - 40, 0) + "px";
      };
      const hide = () => {
        cross.setAttribute("visibility", "hidden");
        dots.forEach((d) => d.setAttribute("r", 4.5));
        tip.classList.add("hidden");
      };
      hit.addEventListener("pointermove", show);
      hit.addEventListener("pointerdown", show);
      hit.addEventListener("pointerleave", hide);
      svg.append(hit);
      plot.prepend(svg);
    };
    setTimeout(draw, 0);
    if ("ResizeObserver" in window) {
      let lastW = 0;
      new ResizeObserver(() => {
        if (plot.clientWidth && plot.clientWidth !== lastW) {
          lastW = plot.clientWidth;
          draw();
        }
      }).observe(plot);
    }
    return wrap;
  }
  var summaryBar = el("div", { className: "ai-status hidden", role: "status", ariaLive: "polite" });
  var pollTimer = null;
  var lastPendingForClient = null;
  var summaryState = null;
  async function checkSummaries(clientId) {
    if (DEMO) return;
    clearTimeout(pollTimer);
    lastPendingForClient = null;
    try {
      showSummaryStatus(await call(`/api/doctor/summaries/status?clientId=${encodeURIComponent(clientId)}`), clientId);
    } catch (err) {
      onError(err);
    }
  }
  async function startSummaries(clientId) {
    if (DEMO) {
      summaryState = { state: "demo" };
      return applySummaryState();
    }
    clearTimeout(pollTimer);
    const btn = $("summarizeBtn");
    if (btn) btn.disabled = true;
    try {
      showSummaryStatus(await call("/api/doctor/summaries/refresh", { method: "POST", body: { clientId } }), clientId, true);
    } catch (err) {
      if (btn) btn.disabled = false;
      onError(err);
    }
  }
  function showSummaryStatus(s, clientId, pressed = false) {
    if (clientId !== activeClient) return;
    summaryState = { ...s, pressed };
    applySummaryState();
    const forThem = s.pendingForClient || 0;
    if (lastPendingForClient !== null && forThem < lastPendingForClient) openClient(clientId, { keepView: true });
    lastPendingForClient = forThem;
    if (s.state === "starting" || s.state === "running") pollTimer = setTimeout(() => pollSummaries(clientId), DEV ? 1500 : 15e3);
  }
  async function pollSummaries(clientId) {
    try {
      showSummaryStatus(await call(`/api/doctor/summaries/status?clientId=${encodeURIComponent(clientId)}`), clientId);
    } catch (err) {
      onError(err);
    }
  }
  function applySummaryState() {
    const s = summaryState;
    const btn = $("summarizeBtn");
    if (!s) return summaryBar.classList.add("hidden");
    const forThem = s.pendingForClient || 0;
    const weeks = (n) => `${n} week${n === 1 ? "" : "s"}`;
    const busy = s.state === "starting" || s.state === "running";
    const text = {
      demo: "Sample preview: summarizing is not available here.",
      "not-configured": "The AI server is not connected yet, so summaries cannot be made.",
      idle: s.pressed ? "Everything is already summarized." : "All weeks are summarized.",
      waiting: forThem ? `${weeks(forThem)} not summarized yet. Press \u201CSummarize recent journals\u201D.` : `This person is up to date. ${weeks(s.pending)} for other people not summarized yet.`,
      starting: "Starting the AI server. This usually takes 2\u20134 minutes; the page updates by itself.",
      running: `Writing summaries\u2026 ${forThem ? `${weeks(forThem)} left for this person, ` : "this person is done, "}${weeks(s.pending)} left in total.`,
      error: `The last run had a problem: ${s.lastError || "unknown error"}`
    }[s.state] || "";
    summaryBar.textContent = text;
    summaryBar.className = `ai-status ${s.state}` + (text ? "" : " hidden");
    if (btn) {
      btn.disabled = busy || s.state === "not-configured" || s.state === "demo";
      btn.textContent = busy ? "Summarizing\u2026" : "Summarize recent journals";
    }
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
