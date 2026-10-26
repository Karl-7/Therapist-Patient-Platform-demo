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
        { id: newId2(), userId: "sample-lina", accountEmail: "lina@example.test", name: "Lina Karim", email: "lina@example.test", session: "Online session", date: "", message: "Evenings work best for me.", status: "new", note: "", created: at(1) },
        { id: newId2(), userId: "sample-omar", accountEmail: "omar@example.test", name: "Omar Haddad", email: "omar@example.test", session: "Individual session", date: "", message: "", status: "contacted", note: "Offered Tuesday or Thursday.", created: at(6) }
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
      const entries2 = db.journals.filter((e) => e.userId === userId && e.week === week);
      db.summaries = db.summaries.filter((s) => !(s.userId === userId && s.week === week));
      if (!entries2.length) return;
      const earlier = [1, 2, 3].map((n) => db.summaries.find((s) => s.userId === userId && s.week === minus(week, n))).filter(Boolean);
      const text = entries2.map((e) => e.text).join(" ");
      const count = (re) => (text.match(re) || []).length;
      const mood = Math.max(1, Math.min(10, 5 + 2 * count(/calm|good|better|happy|fine|جيد/gi) - 2 * count(/sad|angry|mad|anxious|tired|low|غاضب/gi)));
      db.summaries.push({
        userId,
        week,
        entryCount: entries2.length,
        model: "debug",
        mood,
        summary: `(Debug sample, not real AI.) ${entries2.length} ${entries2.length === 1 ? "entry" : "entries"} this week. The real summary of up to 100 words will come from Qwen on your AWS server.`,
        comparison: earlier.length ? `Mood ${mood}/10 vs ${earlier[0].mood}/10 the week before (sample text).` : "First week with entries.",
        changes: earlier.length ? [
          `Mood ${mood >= earlier[0].mood ? "up" : "down"} from ${earlier[0].mood} to ${mood} (sample).`,
          `${entries2.length} entries this week vs ${Math.round(earlier.reduce((a, s) => a + s.entryCount, 0) / earlier.length)} on average before (sample).`
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
  function forwardAuthLinks() {
    if (/(invite|confirmation|recovery|email_change)_token=|access_token=/.test(location.hash) && !location.pathname.endsWith("/login.html")) {
      location.replace("login.html" + location.hash);
      return true;
    }
    return false;
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

  // netlify/lib/tidy.mjs
  var SENTENCE_END = /[.!?。…؟\n]$/;
  var MAX_LOOKBACK = 25;
  var FILLER_EN = /^(u+h+m*|u+m+|e+r+m*|e+m+|a+h+|h+m+|m{2,})$/;
  var FILLER_AR = /^([اإأ]?م{2,}|ا{3,}|[اإأ]?ه{2,}م*)$/;
  var DELETE_VERBS = /* @__PURE__ */ new Set(["delete", "scratch", "strike", "cut", "ignore", "erase", "remove", "\u0627\u062D\u0630\u0641", "\u0627\u0645\u0633\u062D", "\u062A\u062C\u0627\u0647\u0644", "\u0634\u064A\u0644"]);
  var DELETE_OBJECTS = /* @__PURE__ */ new Set(["that", "this", "it", "\u0630\u0644\u0643", "\u0647\u0630\u0627", "\u0647\u0630\u0647", "\u0647\u0630\u064A", "\u0630\u0627\u0643"]);
  var LEAD_INS = /* @__PURE__ */ new Set(["no", "wait", "oh", "actually", "sorry", "ok", "okay", "\u0644\u0627", "\u0644\u062D\u0638\u0629", "\u0639\u0641\u0648\u0627", "\u0622\u0633\u0641", "\u0627\u0633\u0641", "\u0637\u064A\u0628"]);
  var tokenize = (text) => String(text || "").trim().match(/\S+\s*/g) || [];
  var core = (token) => token.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/[ً-ْـ]/g, "");
  function ruleDeletions(tokens) {
    const words = tokens.map(core);
    const out = [];
    words.forEach((w, i) => {
      if (w && (FILLER_EN.test(w) || FILLER_AR.test(w))) out.push({ from: i, to: i, type: "filler", reason: "Filler sound" });
    });
    for (let i = 0; i < words.length - 1; i++) {
      if (!DELETE_VERBS.has(words[i]) || !DELETE_OBJECTS.has(words[i + 1])) continue;
      let cmdStart = i;
      while (cmdStart > 0 && LEAD_INS.has(words[cmdStart - 1])) cmdStart--;
      const cmdEnd = i + 1;
      let start2 = cmdStart;
      if (cmdStart > 0) {
        start2 = cmdStart - 1;
        while (start2 > 0 && cmdStart - start2 < MAX_LOOKBACK && !SENTENCE_END.test(tokens[start2 - 1].trim())) start2--;
      }
      out.push({ from: start2, to: cmdEnd, type: "correction", reason: start2 < cmdStart ? "\u201CDelete that\u201D and what it refers to" : "Spoken command" });
      i = cmdEnd;
    }
    return out;
  }
  function mergeDeletions(list, count) {
    const clean = list.filter((d) => Number.isInteger(d?.from) && Number.isInteger(d?.to)).map((d) => ({ from: Math.max(0, Math.min(d.from, d.to)), to: Math.min(count - 1, Math.max(d.from, d.to)), type: d.type || "other", reason: String(d.reason || "").slice(0, 160) })).filter((d) => d.from <= d.to && d.from < count).sort((a, b) => a.from - b.from || b.to - a.to);
    const merged = [];
    for (const d of clean) {
      const last = merged[merged.length - 1];
      if (last && d.from <= last.to) {
        last.to = Math.max(last.to, d.to);
        if (last.type === "filler" && d.type !== "filler") Object.assign(last, { type: d.type, reason: d.reason });
      } else merged.push({ ...d });
    }
    return merged;
  }
  function applyDeletions(tokens, deletions) {
    const drop = /* @__PURE__ */ new Set();
    deletions.forEach((d) => {
      for (let i = d.from; i <= d.to; i++) drop.add(i);
    });
    const kept = [];
    let afterRemoval = false;
    tokens.forEach((token, i) => {
      if (drop.has(i)) return void (afterRemoval = true);
      const prev = kept[kept.length - 1];
      const sentenceStart = !prev || SENTENCE_END.test(prev.trim());
      const looksLikeLink = /^(https?:|www\.|\S+@\S+)/i.test(token);
      kept.push(afterRemoval && sentenceStart && !looksLikeLink ? token.replace(/^([^\p{L}]*)(\p{Ll})/u, (_, lead, letter) => lead + letter.toUpperCase()) : token);
      afterRemoval = false;
    });
    return kept.join("").replace(/[ \t]+([,.!?;:،؛؟])/g, "$1").replace(/[ \t]{2,}/g, " ").trim().replace(/^[,.;:،؛\s]+/, "");
  }

  // assets/private.js
  var $ = (id) => document.getElementById(id);
  var el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  };
  var reveal = () => document.documentElement.classList.remove("auth-pending");
  function localWeek(date = /* @__PURE__ */ new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function addAccountMenu(user) {
    const nav = $("navlinks");
    if (!nav) return;
    const style = document.createElement("style");
    style.textContent = ".account{display:flex;align-items:center;gap:8px;padding-left:8px;border-left:1px solid var(--line,#e8dfed)}.account span{font-size:12px;color:#8a7fa0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:650px){.account{border-left:0;padding:8px 5px}}.section,.about-page,footer{overflow-wrap:break-word}.grid2>*,.two-fields>*,.about-grid>*{min-width:0}.result,.saved-item,.tidy-text,.affirmation-text,#journalEntries,#bookingStatus,#journalStatus{overflow-wrap:anywhere}";
    document.head.append(style);
    const out = el("button", { className: "btn secondary small", type: "button", textContent: "Sign out" });
    out.onclick = async () => {
      await signOut();
      location.replace(loginUrl("private", "signed-out"));
    };
    nav.append(el("div", { className: "account" }, el("span", { textContent: user.name || user.email || "Signed in", title: user.email || "" }), out));
  }
  var entries = [];
  function setupJournal() {
    if (!$("journalText") || !$("saveJournal")) return;
    const status = (t) => $("journalStatus").textContent = t;
    const share = el("input", { type: "checkbox", id: "journalShare" });
    share.style.cssText = "width:17px;height:17px;accent-color:#7866a8;flex:none";
    const shareLabel = el("label", { htmlFor: "journalShare" }, share, el("span", { textContent: "Share this entry with my therapist" }));
    shareLabel.style.cssText = "display:flex;align-items:center;gap:8px;margin:-4px 0 12px;font-size:14px;cursor:pointer";
    $("journalText").after(shareLabel);
    const notice = document.querySelector("#journal .notice");
    if (notice) {
      notice.textContent = "Entries are saved to your account, so you can read them on any device. Your therapist can read only the entries you share. Each week an AI-written summary of all your entries, shared or not, is prepared for your therapist.";
    }
    const sub = $("journalEntries")?.previousElementSibling;
    if (sub?.classList.contains("sub")) sub.textContent = "Your saved reflections, on every device you sign in to.";
    setupDictationTip();
    const review = setupReview();
    async function saveEntry(text, button) {
      button.disabled = true;
      status("Saving\u2026");
      try {
        const { entry } = await api("/api/journals", { method: "POST", body: { title: $("journalTitle").value.trim(), text, shared: share.checked, week: localWeek(), created: (/* @__PURE__ */ new Date()).toISOString() } });
        entries.unshift(entry);
        $("journalTitle").value = "";
        $("journalText").value = "";
        share.checked = false;
        review.close();
        status(entry.shared ? "Saved and shared with your therapist." : "Saved to your account.");
        renderJournalList();
      } catch (err) {
        status(handleApiError(err, "Could not save. Please try again."));
      } finally {
        button.disabled = false;
      }
    }
    $("saveJournal").textContent = "Tidy up & review";
    $("saveJournal").onclick = () => {
      const text = $("journalText").value.trim();
      if (!text) return status("Write or dictate a little note first.");
      status("");
      const tokens = tokenize(text);
      review.open({ tokens, deletions: mergeDeletions(ruleDeletions(tokens), tokens.length) });
    };
    const asIs = el("button", { className: "btn secondary", type: "button", textContent: "Save as written" });
    asIs.onclick = () => {
      const text = $("journalText").value.trim();
      if (!text) return status("Write a little note before saving.");
      saveEntry(text, asIs);
    };
    $("saveJournal").after(asIs);
    review.onRecord = (text, button) => saveEntry(text, button);
    window.renderJournals = renderJournalList;
    loadJournals();
  }
  function setupDictationTip() {
    const tip = el(
      "div",
      { className: "dictate-tip" },
      el("span", { className: "dictate-icon", textContent: "\u{1F399}\uFE0F", ariaHidden: "true" }),
      el(
        "span",
        {},
        el("strong", { textContent: "Prefer to talk? " }),
        "Tap the microphone on your phone keyboard and just speak, in English or Arabic. Don\u2019t worry about \u201Cum\u201Ds or changing your mind (\u201Cwait, delete that\u201D). Press \u201CTidy up & review\u201D: we strike through the bits that look like fillers or take-backs, and you decide what stays. You can also edit the text yourself before saving."
      )
    );
    const label = document.querySelector('label[for="journalText"]');
    (label || $("journalText")).before(tip);
    $("journalText").setAttribute("dir", "auto");
    $("journalTitle")?.setAttribute("dir", "auto");
  }
  function setupReview() {
    const style = document.createElement("style");
    style.textContent = `
.dictate-tip{display:flex;gap:10px;align-items:flex-start;background:#f6f0fc;border:1px solid #e6dcf2;border-radius:14px;padding:11px 13px;margin:4px 0 14px;font-size:13.5px;color:#5b5677;line-height:1.5}
.dictate-icon{font-size:18px;line-height:1.2}
.tidy-review{border:1px solid #d9cde8;background:#fff;border-radius:16px;padding:16px;margin-top:14px}
.tidy-review h3{margin:0 0 4px;font-size:17px}
.tidy-text{font-size:16px;line-height:1.8;white-space:pre-wrap;border:1px solid var(--line,#e8dfed);border-radius:12px;padding:12px 14px;margin:10px 0;background:#fffdfd;max-height:55vh;overflow:auto}
.tidy-del{all:unset;cursor:pointer;color:#c4548c;background:#fde8f2;text-decoration:line-through;text-decoration-color:#ec7fb2;text-decoration-thickness:2px;border-radius:5px;padding:0 2px}
.tidy-del.kept{color:inherit;background:#eef5ec;text-decoration:none;outline:1px dashed #9cbf98}
.tidy-del:focus-visible{outline:2px solid #7866a8}
.tidy-legend{font-size:13px;color:#77718a;margin:0}
.tidy-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}`;
    document.head.append(style);
    const panel = el("div", { className: "tidy-review hidden", ariaLive: "polite" });
    ($("journalStatus") || $("saveJournal").parentElement).after(panel);
    const ctl = { onRecord: null };
    let tokens = [];
    let deletions = [];
    const finalText = () => applyDeletions(tokens, deletions.filter((d) => !d.kept));
    ctl.close = () => {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      $("journalText").readOnly = false;
    };
    ctl.open = (result) => {
      tokens = result.tokens;
      deletions = result.deletions.map((d) => ({ ...d, kept: false }));
      panel.innerHTML = "";
      const text = el("div", { className: "tidy-text", dir: "auto" });
      let i = 0;
      deletions.forEach((d) => {
        if (d.from > i) text.append(tokens.slice(i, d.from).join(""));
        const b = el("button", { type: "button", className: "tidy-del", title: (d.reason || "Suggested removal") + " \xB7 tap to keep", textContent: tokens.slice(d.from, d.to + 1).join("") });
        b.setAttribute("aria-pressed", "false");
        b.setAttribute("aria-label", `Will be removed: ${b.textContent.trim()}. Tap to keep.`);
        b.onclick = () => {
          d.kept = !d.kept;
          b.classList.toggle("kept", d.kept);
          b.setAttribute("aria-pressed", String(d.kept));
          b.setAttribute("aria-label", `${d.kept ? "Kept" : "Will be removed"}: ${b.textContent.trim()}. Tap to ${d.kept ? "remove" : "keep"}.`);
        };
        text.append(b);
        i = d.to + 1;
      });
      if (i < tokens.length) text.append(tokens.slice(i).join(""));
      const legend = deletions.length ? "Struck-through parts will be removed. Tap any of them to keep it, or choose \u201CEdit text\u201D to change anything yourself." : "Nothing to remove. You can save it, or choose \u201CEdit text\u201D to change anything yourself.";
      const record = el("button", { className: "btn", type: "button", textContent: "Record entry" });
      record.onclick = () => {
        const out = finalText();
        if (!out) return $("journalStatus").textContent = "Everything was removed. Tap a struck-through part to keep it, or go back to editing.";
        ctl.onRecord?.(out, record);
      };
      const edit = el("button", { className: "btn secondary", type: "button", textContent: "Edit text" });
      edit.onclick = () => {
        const out = finalText();
        ctl.close();
        $("journalText").value = out;
        $("journalText").focus();
        $("journalStatus").textContent = "Edit as you like, then press \u201CTidy up & review\u201D again or \u201CSave as written\u201D.";
      };
      const back = el("button", { className: "btn secondary", type: "button", textContent: "Cancel" });
      back.onclick = () => ctl.close();
      panel.append(el("h3", { textContent: "Review before saving" }), el("p", { className: "tidy-legend", textContent: legend }), text, el("div", { className: "tidy-actions" }, record, edit, back));
      panel.classList.remove("hidden");
      $("journalText").readOnly = true;
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      record.focus({ preventScroll: true });
    };
    return ctl;
  }
  async function loadJournals() {
    $("journalEntries").innerHTML = '<p class="empty">Loading your journal\u2026</p>';
    try {
      entries = (await api("/api/journals")).entries;
      renderJournalList();
    } catch (err) {
      $("journalEntries").innerHTML = "";
      $("journalEntries").append(el("p", { className: "empty", textContent: handleApiError(err, "Could not load your journal.") }));
    }
  }
  function renderJournalList() {
    const out = $("journalEntries");
    out.innerHTML = "";
    renderImportBanner(out);
    if (!entries.length) {
      out.append(el("p", { className: "empty", textContent: "Your saved journal entries will appear here." }));
      return;
    }
    entries.forEach((entry) => {
      const badge = el("span", { textContent: entry.shared ? " \xB7 Shared with therapist" : " \xB7 Private" });
      badge.style.cssText = `font-size:12px;font-weight:600;color:${entry.shared ? "#4e7a4c" : "#8a7fa0"}`;
      const toggle = el("button", { className: "btn secondary small", type: "button", textContent: entry.shared ? "Stop sharing" : "Share with therapist" });
      toggle.onclick = async () => {
        toggle.disabled = true;
        try {
          const { entry: updated } = await api(`/api/journals?id=${encodeURIComponent(entry.id)}`, { method: "PATCH", body: { shared: !entry.shared } });
          Object.assign(entry, updated);
          renderJournalList();
        } catch (err) {
          toggle.disabled = false;
          $("journalStatus").textContent = handleApiError(err, "Could not update sharing.");
        }
      };
      const del = el("button", { className: "btn secondary small", type: "button", textContent: "Delete" });
      del.onclick = async () => {
        if (!confirm("Delete this journal entry? This cannot be undone.")) return;
        try {
          await api(`/api/journals?id=${encodeURIComponent(entry.id)}`, { method: "DELETE" });
          entries = entries.filter((x) => x.id !== entry.id);
          renderJournalList();
        } catch (err) {
          $("journalStatus").textContent = handleApiError(err, "Could not delete.");
        }
      };
      const actions = el("div", {}, toggle, del);
      actions.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
      out.append(el(
        "div",
        { className: "result" },
        el("strong", { textContent: entry.title || "My reflection" }),
        el("small", { textContent: " \xB7 " + new Date(entry.created).toLocaleString() }),
        badge,
        el("p", { textContent: entry.text }),
        actions
      ));
    });
  }
  function renderImportBanner(out) {
    let local = [];
    try {
      local = JSON.parse(localStorage.getItem("sst_journals")) || [];
    } catch {
    }
    if (!local.length) return;
    const btn = el("button", { className: "btn small", type: "button", textContent: `Move ${local.length} to my account` });
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Moving\u2026";
      try {
        for (const e of local) {
          const created = e.created || (/* @__PURE__ */ new Date()).toISOString();
          const { entry } = await api("/api/journals", { method: "POST", body: { title: e.title || "", text: e.text, shared: false, created, week: localWeek(new Date(created)) } });
          entries.push(entry);
        }
        localStorage.removeItem("sst_journals");
        entries.sort((a, b) => b.created.localeCompare(a.created));
        renderJournalList();
        $("journalStatus").textContent = "Your earlier entries are now in your account (not shared).";
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Try again";
        $("journalStatus").textContent = handleApiError(err, "Could not move entries.");
      }
    };
    const box = el("div", { className: "result" }, el("p", { textContent: `You have ${local.length} journal ${local.length === 1 ? "entry" : "entries"} saved only in this browser from before.` }), btn);
    box.style.background = "#fcf9ff";
    out.append(box);
  }
  function setupBooking(user) {
    const form = $("bookingForm");
    if (!form) return;
    if ($("bookName") && !$("bookName").value) $("bookName").value = user.name || "";
    if ($("bookEmail") && !$("bookEmail").value) $("bookEmail").value = user.email || "";
    const notice = form.querySelector(".notice");
    if (notice) notice.textContent = "Your enquiry goes straight to the therapist, who will reply by email. Sending it does not confirm an appointment.";
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Send booking enquiry";
    document.addEventListener("submit", async (e) => {
      if (e.target !== form) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const data = Object.fromEntries(new FormData(form));
      const status = (t) => $("bookingStatus").textContent = t;
      submitBtn && (submitBtn.disabled = true);
      status("Sending\u2026");
      try {
        await api("/api/bookings", { method: "POST", body: data });
        form.reset();
        $("bookName").value = user.name || "";
        $("bookEmail").value = user.email || "";
        status("Thank you. Your enquiry has been sent. The therapist will reply by email. This is not yet an appointment confirmation.");
      } catch (err) {
        status(handleApiError(err, "Could not send. Please try again, or email support@safe-spacetherapy.com."));
      } finally {
        submitBtn && (submitBtn.disabled = false);
      }
    }, true);
  }
  async function loadAffirmations() {
    if (typeof library === "undefined" || !Array.isArray(library)) return;
    try {
      const { items } = await api("/api/affirmations");
      if (!Array.isArray(items) || !items.length) return;
      library.splice(0, library.length, ...items);
      if (typeof renderCategories === "function") renderCategories();
      if (typeof renderSearch === "function") renderSearch($("searchInput")?.value || "");
    } catch {
    }
  }
  function handleApiError(err, fallback) {
    if (err?.status === 401) {
      location.replace(loginUrl("private", "expired"));
      return "Your session has ended. Taking you to sign in\u2026";
    }
    return err?.message || fallback;
  }
  async function start() {
    if (forwardAuthLinks()) return;
    let user = null;
    try {
      user = await currentUser2();
    } catch {
      user = null;
    }
    if (!user) return location.replace(loginUrl("private"));
    if (isDoctor2(user)) return location.replace("doctor.html");
    addAccountMenu(user);
    showDevBanner();
    setupJournal();
    setupBooking(user);
    reveal();
    loadAffirmations();
  }
  start();
})();
