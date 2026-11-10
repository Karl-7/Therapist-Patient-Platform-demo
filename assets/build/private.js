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
  var MORE_2 = {
    "Stress & Anxiety": [
      [["anxious", "body", "calm"], "My body is trying to protect me. I can thank it and let it settle."],
      [["worry", "what if", "present"], 'I can answer "what if" with "even if": even if it is hard, I will find a way.'],
      [["stress", "priorities", "enough"], "I can choose what matters most today and let the rest wait."],
      [["nervous", "meeting", "breathing"], "Before I walk in, I can take three slow breaths and remember I belong here."],
      [["anxious", "thoughts", "facts"], "A thought is not a fact. I can notice it without believing it."],
      [["overwhelmed", "list", "one step"], "I do not have to carry the whole list at once. I can pick up one thing."]
    ],
    "Self-Compassion": [
      [["kindness", "inner voice", "gentle"], "I am learning to be on my own side."],
      [["hard day", "rest", "kind"], "Today I will treat myself like someone I am caring for."],
      [["shame", "worth", "human"], "I am human. Struggling does not make me less worthy."],
      [["tired", "enough", "effort"], "The effort I make counts, even when no one sees it."],
      [["comparison", "gentle", "own pace"], "Other people\u2019s progress does not take away from mine."],
      [["regret", "growth", "learning"], "I can look back with understanding, not punishment."]
    ],
    "Mindfulness": [
      [["senses", "grounding", "sound"], "I can listen to the sounds around me and let them bring me back."],
      [["walk", "present", "body"], "With each step, I can feel the ground holding me up."],
      [["tea", "slow", "moment"], "I can do one simple thing slowly and give it my full attention."],
      [["thoughts", "space", "calm"], "There is space around my thoughts. I am the sky, not the weather."],
      [["breathing", "count", "calm"], "Breathing in for four and out for six, my body learns it is safe."],
      [["notice", "feelings", "curious"], "I can notice where I feel this in my body, with curiosity instead of fear."]
    ],
    "ADHD Support": [
      [["adhd", "timer", "start"], "A timer and a small task are a good team. I can begin now."],
      [["adhd", "messy", "enough"], "A messy room or a messy day does not mean I am failing."],
      [["adhd", "interest", "strength"], "When something lights me up, I can trust that energy."],
      [["adhd", "breaks", "rest"], "Taking breaks helps my brain do its best work."],
      [["adhd", "compare", "different"], "I do not need to work the way others do. I can find my own way."],
      [["adhd", "kindness", "reminders"], "Needing reminders is not a flaw. It is how I look after what matters."]
    ],
    "Confidence": [
      [["confidence", "try", "learn"], "I do not need to feel ready to begin. I can grow into it."],
      [["speak up", "voice", "brave"], "My ideas are worth sharing, even if my voice shakes."],
      [["mistakes", "growth", "confidence"], "Every mistake is proof that I am trying."],
      [["strengths", "notice", "proud"], "I can name one thing I did well today."],
      [["doubt", "evidence", "trust"], "When doubt speaks up, I can remember the times I managed."],
      [["new", "brave", "growth"], "New things feel uncomfortable before they feel familiar."]
    ],
    "Relationships": [
      [["communication", "calm", "honest"], "I can say what I need clearly and kindly."],
      [["support", "ask for help", "connection"], "Asking for help lets the people who care about me show up."],
      [["boundaries", "love", "respect"], "Loving someone does not mean I have to agree with everything."],
      [["conflict", "repair", "patience"], "Disagreements can be repaired. One hard talk is not the end."],
      [["friendship", "reach out", "lonely"], "A short message can open a door. I can send one today."],
      [["trust", "time", "healing"], "Trust can be rebuilt slowly, at a pace that feels safe."]
    ],
    "Sleep & Rest": [
      [["sleep", "routine", "calm"], "A calm evening routine tells my body it is time to rest."],
      [["screens", "night", "rest"], "I can put the day and my phone down and let my mind slow."],
      [["tired", "nap", "permission"], "If I need rest, resting is the right choice."],
      [["night", "worry", "writing"], "I can write my worries down and leave them on the page until morning."],
      [["body", "relax", "sleep"], "From my forehead to my toes, I can let each part of my body grow heavy."],
      [["morning", "rested", "gentle"], "However I slept, I can begin this day gently."]
    ],
    "Grief & Loss": [
      [["grief", "waves", "allowed"], "Grief comes in waves. I can let this one pass through me."],
      [["anniversary", "memory", "gentle"], "Hard dates may bring the pain back. I can plan something kind for myself."],
      [["loss", "support", "talk"], "Talking about the person I lost keeps their story alive."],
      [["grief", "laugh", "allowed"], "Laughing again does not mean I have forgotten."],
      [["loss", "change", "identity"], "I am still learning who I am after this loss, and that takes time."],
      [["grief", "body", "tired"], "Grief is tiring. My body needs extra care right now."]
    ],
    "Anger & Frustration": [
      [["angry", "body", "cool down"], "I can notice the heat in my body and give it time to cool."],
      [["frustrated", "patience", "progress"], "This is frustrating, and I can still keep going."],
      [["anger", "needs", "listen"], "Under my anger there may be hurt or fear. I can listen to both."],
      [["angry", "words", "pause"], "I can wait before I speak, so my words match what I really mean."],
      [["frustration", "walk", "release"], "Moving my body can help the frustration leave it."],
      [["resentment", "letting go", "peace"], "Holding on to anger hurts me most. I can loosen my grip a little."]
    ],
    "Motivation": [
      [["start", "tiny", "habit"], "A tiny habit done often beats a big plan never started."],
      [["progress", "celebrate", "small wins"], "I can celebrate small wins. They are how big changes begin."],
      [["tired", "gentle", "enough"], "Some days, doing a little is doing my best."],
      [["purpose", "why", "meaning"], "Remembering why this matters to me gives me energy to continue."],
      [["restart", "fresh start", "try again"], "I can start again at any moment, not only on Mondays."],
      [["focus", "one thing", "now"], "Right now I only need to do the next small thing."]
    ],
    "Body & Health": [
      [["body", "listen", "needs"], "My body sends me messages. I can listen with kindness."],
      [["stretch", "tension", "care"], "A gentle stretch can help me let go of some of the day."],
      [["outside", "fresh air", "light"], "A few minutes outside can change how I feel."],
      [["illness", "patience", "rest"], "Getting better takes time. I can be patient with my body."],
      [["eating", "kindness", "no guilt"], "Food is fuel and comfort, not something to feel guilty about."],
      [["body", "gratitude", "strength"], "I can thank my body for one thing it did for me today."]
    ],
    "Work & Study": [
      [["focus", "study", "breaks"], "Short focused sessions with breaks help me learn more."],
      [["work", "worth", "grades"], "I am more than my job title or my grades."],
      [["presentation", "nervous", "prepared"], "I know more than I think. I can share it one sentence at a time."],
      [["overworked", "rest", "limits"], "I can do good work and still have limits."],
      [["learning", "slow", "patience"], "Learning slowly is still learning."],
      [["colleagues", "support", "ask"], "It is okay not to know. I can ask."]
    ],
    "Parenting": [
      [["parent", "presence", "enough"], "My child needs my presence more than my perfection."],
      [["parent", "guilt", "kindness"], "Parent guilt does not mean I am doing it wrong. It means I care."],
      [["parent", "boundaries", "calm"], "Setting a calm limit is a loving thing to do."],
      [["parent", "alone", "support"], "Other parents struggle too. I am not alone in this."],
      [["parent", "play", "connection"], "Ten minutes of play can mean a lot to my child, and to me."],
      [["parent", "teen", "patience"], "I can stay steady while my child learns who they are."]
    ],
    "Gratitude": [
      [["gratitude", "small things", "notice"], "Today I can find three small things to be thankful for."],
      [["gratitude", "people", "connection"], "I am grateful for the people who make life a little easier."],
      [["gratitude", "body", "breathing"], "I am grateful for every breath my body takes without being asked."],
      [["gratitude", "home", "safe"], "I can appreciate the places where I feel safe."],
      [["gratitude", "hard times", "growth"], "Even hard times have taught me something I value."],
      [["gratitude", "nature", "beauty"], "The sky, the trees, a bird singing: there is beauty around me."],
      [["gratitude", "myself", "effort"], "I am grateful to myself for getting through every day so far."],
      [["gratitude", "food", "care"], "A warm meal is a small gift I can enjoy fully."],
      [["gratitude", "kindness", "strangers"], "I notice the kindness of strangers, and I can pass it on."],
      [["gratitude", "today", "curious"], "Today is a day I have not lived before. I can be curious about it."],
      [["gratitude", "journal", "reflection"], "Writing down what went well helps me see it more often."],
      [["gratitude", "enough", "contentment"], "Right now, in this moment, I have enough."],
      [["gratitude", "morning", "start"], "I can start the day by thanking myself for waking up and trying."]
    ],
    "Hope": [
      [["hope", "future", "possible"], "Things can change, and so can I."],
      [["hope", "dark", "light"], "Even on dark days, a little light gets through."],
      [["hope", "small steps", "future"], "Every small step I take moves me toward a better day."],
      [["hope", "help", "support"], "Help exists, and I deserve to receive it."],
      [["hope", "change", "seasons"], "Like the seasons, hard times change."],
      [["hope", "dreams", "allowed"], "I am allowed to want good things for my life."],
      [["hope", "tomorrow", "try"], "Tomorrow brings a new chance to try."],
      [["hope", "healing", "again"], "I have healed before. I can heal again."],
      [["hope", "stuck", "possible"], "Feeling stuck now does not mean I will always be stuck."],
      [["hope", "people", "understood"], "There are people who will understand me. I can keep looking."],
      [["hope", "strength", "keep going"], "I have made it this far, and that counts."],
      [["hope", "future self", "care"], "My future self will thank me for the care I give today."],
      [["hope", "kindness", "world"], "There is still kindness in the world, and I can be part of it."]
    ],
    "Boundaries": [
      [["boundaries", "no", "respect"], '"No" is a complete sentence.'],
      [["boundaries", "guilt", "kind"], "I can set a boundary and still be a kind person."],
      [["boundaries", "time", "energy"], "My time and energy are worth protecting."],
      [["boundaries", "family", "privacy"], "I can love my family and still decide what I share."],
      [["boundaries", "work", "switch off"], "When my workday ends, I am allowed to switch off."],
      [["boundaries", "people pleasing", "needs"], "Keeping others happy should not cost me my wellbeing."],
      [["boundaries", "phone", "reply"], "I do not have to reply right away."],
      [["boundaries", "change", "update"], "I can change my mind and update my boundaries."],
      [["boundaries", "respect", "relationships"], "The right people will respect my limits."],
      [["boundaries", "calm", "explain"], "I can state my boundary calmly, without over-explaining."],
      [["boundaries", "body", "comfort"], "I decide what feels comfortable for my body."],
      [["boundaries", "space", "healthy"], "Taking space for myself is healthy, not selfish."]
    ],
    "Self-Worth": [
      [["self worth", "enough", "earn"], "My worth is not something I have to earn."],
      [["self worth", "love", "hard days"], "I am worthy of love on my good days and my hard days."],
      [["self worth", "achievement", "matter"], "I matter, apart from anything I achieve."],
      [["self worth", "opinions", "others"], "Other people\u2019s opinions do not decide my value."],
      [["self worth", "voice", "listened"], "I deserve to be listened to."],
      [["self worth", "care", "deserve"], "I deserve the same care I give to others."],
      [["self worth", "looks", "acceptance"], "I am more than how I look."],
      [["self worth", "past", "deserve"], "My past does not decide what I deserve now."],
      [["self worth", "rejection", "value"], "Being rejected by someone does not lower my worth."],
      [["self worth", "strengths", "good"], "There are things about me that are good and true."],
      [["self worth", "belong", "space"], "I belong here as much as anyone else."],
      [["self worth", "self talk", "respect"], "I can talk about myself with respect."]
    ],
    "Change & Uncertainty": [
      [["change", "adapt", "before"], "I have adapted to change before. I can do it again."],
      [["uncertainty", "unknown", "discomfort"], "Not knowing is uncomfortable, and I can live with it for now."],
      [["change", "new", "curious"], "I can meet this change with curiosity as well as fear."],
      [["moving", "new place", "home"], "A new place can slowly become home."],
      [["change", "loss", "mixed feelings"], "Even good changes can bring a sense of loss. Both feelings are okay."],
      [["uncertainty", "control", "focus"], "I can focus on what I can control today."],
      [["change", "routine", "steady"], "Small routines can keep me steady when things are changing."],
      [["decision", "choice", "trust"], "I can make the best choice I can with what I know now."],
      [["change", "growth", "hard"], "Change is how I grow, even when it is hard."],
      [["uncertainty", "future", "today"], "I only need to handle today."],
      [["transition", "settling in", "patience"], "Settling in takes time. I can be patient with myself."],
      [["change", "letting go", "expectations"], "I can let go of how I thought things would be."]
    ],
    "Healing": [
      [["healing", "time", "little by little"], "Healing happens a little at a time."],
      [["healing", "trauma", "safe now"], "I am safe now, even when my body remembers."],
      [["healing", "setback", "normal"], "A setback is part of healing, not the end of it."],
      [["healing", "support", "therapy"], "Getting support is a sign of strength."],
      [["healing", "feelings", "allowed"], "I can feel what I need to feel in order to heal."],
      [["healing", "gentle", "hurting"], "I can be gentle with the parts of me that are still hurting."],
      [["healing", "progress", "notice"], "I can notice how far I have come."],
      [["healing", "rest", "mind"], "My body and mind are doing important work. Rest helps."],
      [["healing", "story", "meaning"], "What happened is part of my story, not all of it."],
      [["healing", "trust", "self"], "I am learning to trust myself again."],
      [["healing", "pain", "future"], "There is life beyond this pain."],
      [["healing", "pace", "no deadline"], "There is no deadline for healing."]
    ],
    "Calm & Peace": [
      [["calm", "breathing", "peace"], "Peace is available to me in this breath."],
      [["calm", "slow", "quiet"], "I can slow down and let the noise settle."],
      [["calm", "waves", "imagine"], "I can imagine my thoughts as waves slowly getting smaller."],
      [["calm", "fix", "peace"], "I do not need to fix everything to feel at peace."],
      [["calm", "body", "soften"], "My shoulders can drop. My jaw can soften."],
      [["calm", "safe place", "imagine"], "I can picture a calm place and rest there for a moment."],
      [["calm", "music", "comfort"], "Gentle music can help me feel calm."],
      [["calm", "nature", "water"], "Being near trees or water can quiet my mind."],
      [["calm", "pause", "respond"], "Between what happens and how I respond, there is a pause I can use."],
      [["peace", "acceptance", "moment"], "I can accept this moment as it is."],
      [["calm", "evening", "wind down"], "Evenings can be for winding down, not catching up."],
      [["calm", "hand on heart", "grounding"], "I can place a hand on my chest and feel my breath slow."],
      [["calm", "counting", "grounding"], "Counting slowly to ten can help me find my calm again."]
    ],
    "Courage": [
      [["courage", "fear", "brave"], "Courage is not the absence of fear; it is moving with it."],
      [["courage", "small", "counts"], "Small brave acts count."],
      [["courage", "help", "ask"], "Asking for help takes courage, and I have it."],
      [["courage", "truth", "honest"], "I can speak my truth with care."],
      [["courage", "new", "try"], "I can try something new, even if I am not sure how it will go."],
      [["courage", "change", "good for me"], "I have the courage to make changes that are good for me."],
      [["courage", "feelings", "face"], "I can face my feelings instead of running from them."],
      [["courage", "stand up", "myself"], "Standing up for myself is brave."],
      [["courage", "fail", "grow"], "I am willing to fail sometimes in order to grow."],
      [["courage", "appointment", "call"], "Making that call or that appointment is a brave step."],
      [["courage", "strength", "inside"], "There is more strength in me than I can see right now."],
      [["courage", "show up", "today"], "Showing up today, as I am, is an act of courage."]
    ],
    "Joy": [
      [["joy", "small", "count"], "I can let small joys count."],
      [["joy", "laugh", "hard times"], "I am allowed to laugh, even in hard seasons."],
      [["joy", "play", "fun"], "Play is not only for children. I can make time for fun."],
      [["joy", "music", "dance"], "A favourite song can lift my mood. I can turn it up."],
      [["joy", "people", "love"], "Time with people I love fills me up."],
      [["joy", "creativity", "make"], "Making something, however small, can bring me joy."],
      [["joy", "sunlight", "simple"], "Sunlight on my face is a simple pleasure."],
      [["joy", "savour", "moment"], "When something good happens, I can pause and savour it."],
      [["joy", "hobbies", "time"], "I deserve time for things I enjoy."],
      [["joy", "notice", "more"], "The more I notice joy, the more I find it."],
      [["joy", "share", "grow"], "Sharing joy makes it grow."],
      [["joy", "happy", "no reason"], "I do not need a reason to feel happy."],
      [["joy", "memories", "smile"], "I can remember a moment that made me smile and let it warm me now."]
    ],
    "Forgiveness": [
      [["forgiveness", "self", "learn"], "I can forgive myself and still learn from what happened."],
      [["forgiveness", "others", "freedom"], "Forgiving does not mean forgetting. It means freeing myself."],
      [["forgiveness", "not ready", "okay"], "If I am not ready to forgive, that is okay too."],
      [["forgiveness", "past self", "kindness"], "I can be kind to who I was then."],
      [["forgiveness", "weight", "release"], "I can let go of some of this weight, a little at a time."],
      [["forgiveness", "distance", "safe"], "I can forgive someone and still keep my distance."],
      [["forgiveness", "apology", "sorry"], "Saying sorry and meaning it is a strong thing to do."],
      [["forgiveness", "imperfect", "human"], "Everyone gets things wrong. I am allowed to be imperfect."],
      [["forgiveness", "understanding", "harm"], "I can try to understand where others came from, without excusing harm."],
      [["forgiveness", "peace", "being right"], "Peace in my heart matters more than being right."],
      [["forgiveness", "second chance", "myself"], "I can give myself a second chance."],
      [["forgiveness", "journey", "time"], "Forgiveness can be a journey, not a single moment."]
    ]
  };
  var n = FIRST.length;
  var build = (groups) => Object.entries(groups).flatMap(([category, items]) => items.map(([tags, text]) => ({ id: `a${++n}`, category, tags, text })));
  var DEFAULT_AFFIRMATIONS = [...FIRST, ...build(MORE), ...build(MORE_2)];

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
    const pickSome2 = (list, n2) => [...list].sort(() => rand() - 0.5).slice(0, n2);
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
        const days = pickSome2([0, 1, 2, 3, 4, 5, 6], 3 + Math.floor(rand() * 4)).sort((a, b) => a - b);
        const shared = new Set(pickSome2(days, Math.min(days.length, 1 + Math.floor(rand() * 3))));
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
  function moodSentence(counts, order = Object.keys(counts)) {
    const names = [...new Set(order)].filter((m) => counts[m] > 0);
    if (!names.length) return "";
    names.sort((a, b) => counts[b] - counts[a] || order.indexOf(a) - order.indexOf(b));
    const showStrength = names.some((m) => counts[m] > 1);
    const word = (m) => (showStrength ? counts[m] >= 3 ? "very " : counts[m] === 2 ? "quite " : "a bit " : "") + m.toLowerCase();
    const parts = names.map(word);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
    return `I feel ${list} today.`;
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
    if (!user && !(route === "/api/bookings" && method === "POST")) throw fail(401, "Please sign in.");
    if (route === "/api/journals") {
      if (isDoctor(user)) throw fail(403, "Doctor accounts do not keep a journal.");
      const mine = db.journals.filter((e) => e.userId === user.id && e.kind !== "mood");
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
    if (route === "/api/moods") {
      if (isDoctor(user)) throw fail(403, "Mood check-ins are for Private accounts.");
      if (!MOOD_NAMES.includes(body?.mood)) throw fail(400, "Unknown mood");
      const date = body.date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      let day = db.journals.find((e) => e.userId === user.id && e.kind === "mood" && e.date === date);
      if (!day) {
        day = { id: "mood-" + date, userId: user.id, kind: "mood", date, counts: {}, order: [], title: "", shared: false, created: body.created || date + "T00:00:00", week: body.week || weekOf(date + "T12:00:00") };
        db.journals.push(day);
      }
      day.counts[body.mood] = (day.counts[body.mood] || 0) + 1;
      if (!day.order.includes(body.mood)) day.order.push(body.mood);
      day.text = moodSentence(day.counts, day.order);
      db.queue[`${user.id}/${day.week}`] = Date.now();
      saveDb(db);
      return { ok: true };
    }
    if (route === "/api/favorites") {
      if (isDoctor(user)) throw fail(403, "Favorites are for Private accounts.");
      db.favorites || (db.favorites = {});
      let items = db.favorites[user.id] || [];
      if (method === "POST") {
        if (!body?.id || !body?.text) throw fail(400, "Missing affirmation");
        items = [{ id: body.id, text: body.text, category: body.category || "", savedAt: (/* @__PURE__ */ new Date()).toISOString() }, ...items.filter((x) => x.id !== body.id)];
      }
      if (method === "DELETE") items = items.filter((x) => x.id !== id);
      db.favorites[user.id] = items;
      saveDb(db);
      return { items: clone(items) };
    }
    if (route === "/api/bookings") {
      if (method === "POST") {
        if (!body?.name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body?.email || "")) throw fail(400, "Please add your name and a valid email.");
        const booking = { id: newId(), userId: user?.id || null, accountEmail: user?.email || "", guest: !user, name: body.name.trim(), email: body.email.trim(), service: body.service || "", session: body.session || "", date: body.date || "", message: (body.message || "").trim(), status: "new", note: "", created: (/* @__PURE__ */ new Date()).toISOString() };
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
      db.journals.filter((e) => e.userId === clientId && e.shared && e.kind !== "mood").forEach(({ id: eid, title, text, created, week }) => slot(week).shared.push({ id: eid, title, text, created, week }));
      waiting.forEach((w) => slot(w));
      const list = [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week));
      list.forEach((w) => w.shared.sort((a, b) => a.created.localeCompare(b.created)));
      return clone({ client, weeks: list, notes: db.notes[clientId] || { symptoms: "" } });
    }
    throw fail(405, "Method not allowed");
  }
  var DEBUG_RUN_MS = 4e3;
  function runDebugSummaries(db) {
    const minus = (week, n2) => {
      const d = /* @__PURE__ */ new Date(week + "T00:00:00");
      d.setDate(d.getDate() - 7 * n2);
      return weekOf(d.toISOString());
    };
    Object.keys(db.queue).sort((a, b) => a.split("/")[1].localeCompare(b.split("/")[1])).forEach((key) => {
      const [userId, week] = key.split("/");
      const all = db.journals.filter((e) => e.userId === userId && e.week === week);
      const entries2 = all.filter((e) => e.kind !== "mood");
      const moodLines = all.filter((e) => e.kind === "mood").map((e) => e.text);
      db.summaries = db.summaries.filter((s) => !(s.userId === userId && s.week === week));
      if (!all.length) return;
      const earlier = [1, 2, 3].map((n2) => db.summaries.find((s) => s.userId === userId && s.week === minus(week, n2))).filter(Boolean);
      const text = entries2.map((e) => e.text).join(" ");
      const count = (re) => (text.match(re) || []).length;
      const mood = Math.max(1, Math.min(10, 5 + 2 * count(/calm|good|better|happy|fine|جيد/gi) - 2 * count(/sad|angry|mad|anxious|tired|low|غاضب/gi)));
      db.summaries.push({
        userId,
        week,
        entryCount: entries2.length,
        model: "debug",
        mood,
        summary: `(Debug sample, not real AI.) ${entries2.length} ${entries2.length === 1 ? "entry" : "entries"} this week.${moodLines.length ? " Mood check-ins: " + moodLines.join(" ") : ""} The real summary of up to 100 words will come from Qwen on your AWS server.`,
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
      let t = token;
      if (afterRemoval) {
        const prev = kept[kept.length - 1];
        if (prev === void 0) t = t.replace(/^[,.;:،؛]+\s*/, "");
        else if (/^[,.!?;:،؛؟]/.test(t)) kept[kept.length - 1] = prev.replace(/[ \t]+$/, "");
        const sentenceStart = prev === void 0 || SENTENCE_END.test(prev.trim());
        if (sentenceStart && !/^(https?:|www\.|\S+@\S+)/i.test(t)) t = t.replace(/^([^\p{L}]*)(\p{Ll})/u, (_, lead, letter) => lead + letter.toUpperCase());
      }
      if (t) kept.push(t);
      afterRemoval = false;
    });
    return kept.join("").replace(/[ \t]+([,.!?;:،؛؟])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  }

  // assets/affirmations-ui.js
  var $ = (id) => document.getElementById(id);
  var el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids.filter((k) => k !== null && k !== void 0));
    return node;
  };
  var favorites = [];
  var featured = null;
  var topic = null;
  var topicPicks = [];
  var PER_TOPIC = 3;
  var TOPICS_SHOWN = 5;
  var topicView = [];
  var searchFor = "";
  var searchPicks = [];
  var favFilter = "All";
  var onError = (err) => console.error(err);
  var isSaved = (item) => favorites.some((f) => f.id === item.id);
  var lib = () => typeof library !== "undefined" && Array.isArray(library) ? library : [];
  var guest = false;
  async function setupAffirmations(handleError, { guest: isGuest = false } = {}) {
    onError = handleError || onError;
    guest = isGuest;
    const hasUi = $("searchResults") || $("favoriteList") || $("featuredQuote");
    if (!hasUi) return;
    window.renderSearch = renderSearch2;
    window.renderCategories = renderTopics;
    window.renderFavorites = renderFavorites;
    await loadFavorites();
    setupFeatured();
    setupSearchRefresh();
    renderTopics();
    renderSearch2($("searchInput")?.value || "");
    renderFavorites();
  }
  function refreshAffirmations() {
    if (featured && !lib().some((x) => x.id === featured.id)) pickFeatured();
    if (topic && !lib().some((x) => x.category === topic)) topic = null;
    if (topic && topicPicks.some((p) => !lib().some((x) => x.id === p.id))) pickTopic();
    renderTopics();
    renderSearch2($("searchInput")?.value || "");
    updateSaveButtons();
  }
  async function loadFavorites() {
    if (guest) return;
    try {
      favorites = (await api("/api/favorites")).items || [];
      let local = [];
      try {
        local = JSON.parse(localStorage.getItem("sst_favorites")) || [];
      } catch {
      }
      for (const f of local.filter((x) => x?.id && x?.text && !favorites.some((y) => y.id === x.id))) {
        favorites = (await api("/api/favorites", { method: "POST", body: { id: f.id, text: f.text, category: f.category || "" } })).items;
      }
      if (local.length) try {
        localStorage.removeItem("sst_favorites");
      } catch {
      }
    } catch (err) {
      onError(err);
    }
  }
  async function toggleSave(item, button) {
    if (guest) return onError(Object.assign(new Error("Please sign in first."), { status: 401 }));
    if (button) button.disabled = true;
    try {
      const res = isSaved(item) ? await api(`/api/favorites?id=${encodeURIComponent(item.id)}`, { method: "DELETE" }) : await api("/api/favorites", { method: "POST", body: { id: item.id, text: item.text, category: item.category || "" } });
      favorites = res.items || [];
    } catch (err) {
      onError(err);
    } finally {
      if (button) button.disabled = false;
    }
    updateSaveButtons();
    renderFavorites();
  }
  function saveButton(item) {
    const b = el("button", { type: "button", className: "btn secondary small save-aff" });
    b.dataset.id = item.id;
    b.onclick = () => toggleSave(item, b);
    paintSave(b, item);
    return b;
  }
  function paintSave(b, item) {
    const saved = isSaved(item);
    b.textContent = saved ? "\u2713 Saved" : "\u2661 Save";
    b.setAttribute("aria-pressed", String(saved));
    b.title = saved ? "Saved to Your Favorites. Tap to remove." : "Save to Your Favorites";
  }
  function updateSaveButtons() {
    document.querySelectorAll(".save-aff").forEach((b) => {
      const item = b.dataset.featured ? featured : lib().find((x) => x.id === b.dataset.id) || favorites.find((x) => x.id === b.dataset.id);
      if (item) paintSave(b, item);
    });
  }
  function renderSearch2(query = "") {
    const out = $("searchResults");
    if (!out) return;
    const q = query.trim().toLowerCase();
    if (q && topic) {
      topic = null;
      renderTopics();
    }
    out.innerHTML = "";
    let items;
    let note = "";
    if (q) {
      const matches = searchMatches(q);
      if (q !== searchFor) {
        searchFor = q;
        searchPicks = pickThree(matches, []);
      }
      paintSearchRefresh(matches.length);
      if (!matches.length) return out.append(el("p", { className: "empty", textContent: "No match yet. Try another word or topic." }));
      items = searchPicks;
      if (matches.length > items.length) note = `Showing ${items.length} of ${matches.length} matches. Tap \u21BB for others.`;
    } else {
      searchFor = "";
      paintSearchRefresh(0);
      if (topic) items = topicPicks;
      else return out.append(el("p", { className: "notice", textContent: `Search above or choose a topic below to explore ${lib().length} affirmations.` }));
    }
    items.forEach((item) => out.append(el("div", { className: "result" }, el("small", { textContent: item.category }), el("p", { textContent: `\u201C${item.text}\u201D` }), saveButton(item))));
    if (note) out.append(el("p", { className: "notice search-note", textContent: note }));
  }
  var searchMatches = (q) => lib().filter((x) => `${x.text} ${x.category} ${(x.tags || []).join(" ")}`.toLowerCase().includes(q));
  var pickThree = (pool, current) => pickSome(pool, current, PER_TOPIC);
  function pickSome(pool, current, count) {
    const key = (x) => typeof x === "string" ? x : x.id;
    const fresh = pool.filter((x) => !current.some((p) => key(p) === key(x)));
    const from = fresh.length >= count ? fresh : pool;
    return [...from].sort(() => Math.random() - 0.5).slice(0, count);
  }
  function setupSearchRefresh() {
    const input = $("searchInput");
    if (!input || document.getElementById("searchRefresh")) return;
    const style = el("style", { textContent: `
.search-wrap{position:relative}
.search-wrap .field{padding-right:52px}
#searchRefresh{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;border:1px solid #dfd4eb;background:#fff;color:#66528f;font-size:18px;line-height:1;cursor:pointer}
#searchRefresh:hover:not(:disabled){background:#f6f0fc}
#searchRefresh:disabled{opacity:.4;cursor:default}
.search-note{margin:8px 0 0}
.chip.more-topics{border-style:dashed;color:#66528f;font-weight:600;background:transparent}` });
    document.head.append(style);
    const wrap = el("div", { className: "search-wrap" });
    input.replaceWith(wrap);
    const btn = el("button", { type: "button", id: "searchRefresh", className: "hidden", textContent: "\u21BB", title: "Show three other matches", ariaLabel: "Show three other matches" });
    btn.onclick = () => {
      const q = input.value.trim().toLowerCase();
      searchPicks = pickThree(searchMatches(q), searchPicks);
      searchFor = q;
      renderSearch2(input.value);
      input.focus();
    };
    wrap.append(input, btn);
  }
  function paintSearchRefresh(matchCount) {
    const btn = document.getElementById("searchRefresh");
    if (!btn) return;
    btn.classList.toggle("hidden", !$("searchInput")?.value.trim());
    btn.disabled = matchCount <= PER_TOPIC;
    btn.title = btn.disabled ? "All matches are shown" : "Show three other matches";
  }
  function renderTopics() {
    const chips = $("categoryChips");
    if (!chips) return;
    const all = [...new Set(lib().map((x) => x.category).filter(Boolean))];
    if (!topicView.length || topicView.some((c) => !all.includes(c))) topicView = pickSome(all, [], TOPICS_SHOWN);
    if (topic && !topicView.includes(topic)) topicView = [topic, ...topicView.filter((c) => c !== topic)].slice(0, TOPICS_SHOWN);
    chips.innerHTML = "";
    topicView.forEach((c) => {
      const active = c === topic;
      const b = el("button", { type: "button", className: "chip" + (active ? " active" : ""), textContent: active ? `\u21BB ${c}` : c });
      b.title = active ? `Show three other ${c} affirmations` : `Show three ${c} affirmations`;
      b.setAttribute("aria-pressed", String(active));
      b.onclick = () => {
        topic = c;
        pickTopic();
        if ($("searchInput")) $("searchInput").value = "";
        renderTopics();
        renderSearch2("");
        chips.querySelector(".chip.active")?.focus();
      };
      chips.append(b);
    });
    if (all.length > TOPICS_SHOWN) {
      const more = el("button", { type: "button", className: "chip more-topics", textContent: "\u21BB More topics", title: "Show other topics" });
      more.onclick = () => {
        const others = all.filter((c) => c !== topic);
        const fresh = pickSome(others, topicView, topic ? TOPICS_SHOWN - 1 : TOPICS_SHOWN);
        topicView = topic ? [topic, ...fresh] : fresh;
        renderTopics();
        chips.querySelector(".more-topics")?.focus();
      };
      chips.append(more);
    }
  }
  function pickTopic() {
    topicPicks = pickThree(lib().filter((x) => x.category === topic), topicPicks);
  }
  function setupFeatured() {
    const quote = $("featuredQuote");
    const next = $("newQuote");
    if (!quote || !next) return;
    const save = el("button", { type: "button", className: "btn small save-aff" });
    save.dataset.featured = "1";
    save.onclick = () => featured && toggleSave(featured, save);
    next.after(save);
    next.onclick = pickFeatured;
    pickFeatured();
  }
  function pickFeatured() {
    const items = lib().filter((x) => x.id !== featured?.id);
    if (!items.length || !$("featuredQuote")) return;
    featured = items[Math.floor(Math.random() * items.length)];
    $("featuredQuote").textContent = featured.text;
    const save = document.querySelector(".save-aff[data-featured]");
    if (save) paintSave(save, featured);
  }
  function renderFavorites() {
    const list = $("favoriteList");
    const filters = $("favoriteFilters");
    if (!list) return;
    const cats = ["All", ...new Set(favorites.map((x) => x.category).filter(Boolean))];
    if (!cats.includes(favFilter)) favFilter = "All";
    if (filters) {
      filters.innerHTML = "";
      if (favorites.length) {
        cats.forEach((c) => {
          const b = el("button", { type: "button", className: "chip" + (favFilter === c ? " active" : ""), textContent: c });
          b.onclick = () => {
            favFilter = c;
            renderFavorites();
          };
          filters.append(b);
        });
      }
    }
    list.innerHTML = "";
    const shown = favorites.filter((x) => favFilter === "All" || x.category === favFilter);
    if (!shown.length) {
      list.append(el("p", { className: "empty", textContent: "No saved affirmations yet. Tap \u201C\u2661 Save\u201D on one you love and it will appear here." }));
      return;
    }
    shown.forEach((item) => {
      const remove = el("button", { type: "button", className: "btn secondary small", textContent: "Remove" });
      remove.onclick = () => toggleSave(item, remove);
      list.append(el("article", { className: "saved-item" }, el("small", { textContent: item.category || "Saved" }), el("p", { textContent: `\u201C${item.text}\u201D` }), remove));
    });
  }

  // assets/mood-checkin.js
  var QUOTES = {
    Happy: "Let yourself enjoy this moment. You deserve the little joys, too. \u{1F49B}",
    Sad: "It is okay to feel sad. You do not have to pretend to be okay to deserve care. \u{1F497}",
    Anxious: "Come back to one slow breath. You only need to take the next small step. \u{1F33F}",
    Stressed: "Pause for a moment. You are allowed to rest, even when there is more to do. \u2601\uFE0F",
    Overwhelmed: "You do not have to do everything at once. One small thing is enough for now. \u{1F497}",
    Lonely: "Even when you feel alone, you still matter and you are worthy of connection. \u{1FAF6}",
    Okay: "You do not need to feel amazing every day. Being here is enough. \u{1F33C}",
    Good: "Let this good feeling have a little space. You are allowed to enjoy it. \u2728",
    Great: "Celebrate this moment and the light you are carrying today. \u2600\uFE0F"
  };
  var TITLE = "How are you feeling today?";
  var SUB = "Choose the mood that feels closest to you right now.";
  var NOTICE = "Tap as often as you like, even on days you do not feel like writing.";
  var narrow = window.matchMedia("(max-width: 650px)");
  var visibleCount = () => narrow.matches ? 2 : 5;
  var el2 = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids.filter((k) => k !== null && k !== void 0));
    return node;
  };
  var pad = (n2) => String(n2).padStart(2, "0");
  var ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  var onError2 = (err) => console.error(err);
  var guest2 = false;
  function setupMoodPickers(handleError, { guest: isGuest = false } = {}) {
    onError2 = handleError || onError2;
    guest2 = isGuest;
    addStyles();
    const home = document.getElementById("mood");
    if (home) {
      home.querySelector("h2") && (home.querySelector("h2").textContent = TITLE);
      home.querySelector(".sub") && (home.querySelector(".sub").textContent = SUB);
      home.querySelector(".mood-controls")?.replaceWith(...buildPicker());
      home.querySelector(".notice")?.remove();
      home.append(el2("p", { className: "notice", textContent: NOTICE }));
    }
    const journal = document.getElementById("journal");
    if (journal && !journal.querySelector(".mood-checkin")) {
      const block = el2("div", { className: "mood-checkin center" }, el2("h2", { textContent: TITLE }), el2("p", { className: "sub", textContent: SUB }), ...buildPicker(), el2("p", { className: "notice", textContent: NOTICE }));
      journal.prepend(block);
    }
  }
  function buildPicker() {
    let start2 = 0;
    const row = el2("div", { className: "moods" });
    const status = el2("p", { className: "mood-status", role: "status", ariaLive: "polite" });
    const prev = el2("button", { type: "button", className: "arrow", ariaLabel: "Previous moods", textContent: "\u2039" });
    const next = el2("button", { type: "button", className: "arrow", ariaLabel: "More moods", textContent: "\u203A" });
    const render = () => {
      const visible = visibleCount();
      start2 = Math.min(start2, MOODS.length - visible);
      row.innerHTML = "";
      MOODS.slice(start2, start2 + visible).forEach(([emoji, name]) => {
        const b = el2("button", { type: "button", className: "mood", ariaLabel: `I feel ${name.toLowerCase()}` }, el2("span", { textContent: emoji }), name);
        b.onclick = () => tap(b, emoji, name, status);
        row.append(b);
      });
      prev.disabled = start2 === 0;
      next.disabled = start2 + visible >= MOODS.length;
    };
    prev.onclick = () => {
      start2 = Math.max(0, start2 - 1);
      render();
    };
    next.onclick = () => {
      start2 = Math.min(MOODS.length - visibleCount(), start2 + 1);
      render();
    };
    narrow.addEventListener("change", render);
    render();
    return [el2("div", { className: "mood-controls" }, prev, row, next), status];
  }
  async function tap(button, emoji, name, status) {
    rise(button, emoji);
    status.textContent = QUOTES[name] || "Thank you for checking in with yourself.";
    const now = /* @__PURE__ */ new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    if (guest2) {
      onError2(Object.assign(new Error("Please sign in first."), { status: 401 }));
      return;
    }
    try {
      await api("/api/moods", {
        method: "POST",
        body: { mood: name, date: ymd(now), week: ymd(monday), created: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() }
      });
    } catch (err) {
      status.textContent = "That tap could not be noted. Please try again.";
      onError2(err);
    }
  }
  function rise(button, emoji) {
    button.classList.remove("tapped");
    void button.offsetWidth;
    button.classList.add("tapped");
    const r = button.getBoundingClientRect();
    const float = el2("span", { className: "mood-float", textContent: emoji, ariaHidden: "true" });
    float.style.left = `${r.left + r.width / 2}px`;
    float.style.top = `${r.top + r.height / 2 - 10}px`;
    floatLayer().append(float);
    float.addEventListener("animationend", () => float.remove());
    setTimeout(() => float.remove(), 1500);
  }
  function floatLayer() {
    let layer = document.getElementById("mood-float-layer");
    if (!layer) {
      layer = el2("div", { id: "mood-float-layer", ariaHidden: "true" });
      document.body.append(layer);
    }
    return layer;
  }
  function addStyles() {
    if (document.getElementById("mood-checkin-style")) return;
    const style = el2("style", { id: "mood-checkin-style" });
    style.textContent = `
.mood-checkin{margin-bottom:28px;padding-bottom:26px;border-bottom:1px solid var(--line,#e8dfed)}
.mood-checkin h2{margin-bottom:8px}
.mood-status{min-height:22px;margin:12px 0 0;font-size:14px;color:#6b6283}
.mood.tapped{animation:moodPress .35s ease}
.mood:disabled,.arrow:disabled{opacity:.35;cursor:default}
#mood-float-layer{position:fixed;inset:0;z-index:2147483647;pointer-events:none;isolation:isolate}
.mood-float{position:fixed;pointer-events:none;font-size:34px;transform:translate(-50%,-50%);animation:moodRise .95s ease-out forwards;will-change:transform,opacity}
#mood h2,#mood .sub,.mood-checkin h2,.mood-checkin .sub{position:relative;z-index:1}
.mood-controls{position:relative;z-index:2}
/* The row hides cards that are scrolled out of view; leave room so a lifted or pressed card is never cut off. */
.mood-controls .moods{padding:6px 3px;margin:-6px -3px}
@keyframes moodRise{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}70%{opacity:.9}100%{opacity:0;transform:translate(-50%,-150px) scale(1.6)}}
@keyframes moodPress{0%{transform:scale(1)}40%{transform:scale(.93)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.mood-float{animation-duration:.01s}.mood.tapped{animation:none}}`;
    document.head.append(style);
  }

  // assets/private.js
  var $2 = (id) => document.getElementById(id);
  var el3 = (tag, props = {}, ...kids) => {
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
  var signedIn = false;
  function addSharedStyles() {
    const style = document.createElement("style");
    style.textContent = ".account{display:flex;align-items:center;gap:8px;padding-left:8px;border-left:1px solid var(--line,#e8dfed)}.account span{font-size:12px;color:#8a7fa0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:650px){.account{border-left:0;padding:8px 5px}}.section,.about-page,footer{overflow-wrap:break-word}.grid2>*,.two-fields>*,.about-grid>*{min-width:0}.result,.saved-item,.tidy-text,.affirmation-text,#journalEntries,#bookingStatus,#journalStatus{overflow-wrap:anywhere}a.btn,a.btn:hover{text-decoration:none}.step-link{display:block;text-decoration:none;color:inherit;cursor:pointer;transition:transform .18s,box-shadow .18s,border-color .18s}.step-link:hover,.step-link:focus-visible{transform:translateY(-3px);border-color:#b7a4d0;box-shadow:0 8px 22px #57466d18}.step-link:focus-visible{outline:2px solid #b7a4d0;outline-offset:2px}.signin-card{text-align:center;padding:30px 20px;border:1px dashed #d9cde8;border-radius:18px;background:#fff}.signin-card h3{margin:0 0 6px;font-size:20px}.signin-card p{color:var(--muted,#73778c);margin:0 auto 16px;max-width:460px}.signin-card .row-actions{justify-content:center}.signin-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9998;display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:calc(100% - 32px);background:#35405f;color:#fff;font-size:14px;padding:10px 14px;border-radius:14px;box-shadow:0 8px 24px #0003}.signin-toast .btn{padding:7px 14px;font-size:13px}.navlinks .account a.btn{color:#fff}.navlinks .account a.btn:hover{color:#fff}";
    document.head.append(style);
  }
  var signInUrl = (mode) => loginUrl("private") + (mode === "signup" ? "&mode=signup" : "") + (location.hash ? "&hash=" + encodeURIComponent(location.hash.slice(1)) : "");
  function addAccountMenu(user) {
    const nav = $2("navlinks");
    if (!nav) return;
    if (!user) {
      nav.append(el3("div", { className: "account" }, el3("a", { className: "btn small", href: signInUrl(), textContent: "Sign in" })));
      return;
    }
    const out = el3("button", { className: "btn secondary small", type: "button", textContent: "Sign out" });
    out.onclick = async () => {
      await signOut();
      location.reload();
    };
    nav.append(el3("div", { className: "account" }, el3("span", { textContent: user.name || user.email || "Signed in", title: user.email || "" }), out));
  }
  function askToSignIn(message, { signup: signup2 = false } = {}) {
    document.querySelector(".signin-toast")?.remove();
    const close = el3("button", { type: "button", className: "btn secondary small", textContent: "Not now" });
    const go = el3("a", { className: "btn small", href: signInUrl(signup2 ? "signup" : void 0), textContent: signup2 ? "Create account" : "Sign in" });
    const toast = el3("div", { className: "signin-toast", role: "status" }, el3("span", { textContent: message }), go, close);
    close.onclick = () => toast.remove();
    document.body.append(toast);
  }
  function setupGuestJournal() {
    const section = $2("journal");
    if (!section || !$2("journalText")) return;
    section.querySelector(".grid2")?.classList.add("hidden");
    section.append(el3(
      "div",
      { className: "signin-card" },
      el3("div", { className: "eyebrow", textContent: "CHECK IN WITH YOURSELF" }),
      el3("h3", { textContent: "Keep a private journal" }),
      el3("p", { textContent: "Sign in to write, or talk to record your day. Your journal is private, and you choose which ones your therapist sees." }),
      el3(
        "div",
        { className: "row-actions" },
        el3("a", { className: "btn", href: signInUrl(), textContent: "Sign in" }),
        el3("a", { className: "btn secondary", href: signInUrl("signup"), textContent: "Create an account" })
      )
    ));
  }
  var entries = [];
  function setupJournal() {
    if (!$2("journalText") || !$2("saveJournal")) return;
    const status = (t) => $2("journalStatus").textContent = t;
    const share = el3("input", { type: "checkbox", id: "journalShare" });
    share.style.cssText = "width:17px;height:17px;accent-color:#7866a8;flex:none";
    const shareLabel = el3("label", { htmlFor: "journalShare" }, share, el3("span", { textContent: "Share this entry with my therapist" }));
    shareLabel.style.cssText = "display:flex;align-items:center;gap:8px;margin:-4px 0 12px;font-size:14px;cursor:pointer";
    $2("journalText").after(shareLabel);
    const notice = document.querySelector("#journal .notice");
    if (notice) {
      notice.textContent = "Entries are saved to your account, so you can read them on any device. Your therapist can read only the entries you share. Each week an AI-written summary of all your entries and mood check-ins, shared or not, is prepared for your therapist.";
    }
    const sub = $2("journalEntries")?.previousElementSibling;
    if (sub?.classList.contains("sub")) sub.textContent = "Your saved reflections, on every device you sign in to.";
    setupDictationTip();
    const review = setupReview();
    async function saveEntry(text, button) {
      button.disabled = true;
      status("Saving\u2026");
      try {
        const { entry } = await api("/api/journals", { method: "POST", body: { text, shared: share.checked, week: localWeek(), created: (/* @__PURE__ */ new Date()).toISOString() } });
        entries.unshift(entry);
        $2("journalText").value = "";
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
    $2("saveJournal").textContent = "Tidy up & review";
    $2("saveJournal").onclick = () => {
      const text = $2("journalText").value.trim();
      if (!text) return status("Write or dictate a little note first.");
      status("");
      const tokens = tokenize(text);
      review.open({ tokens, deletions: mergeDeletions(ruleDeletions(tokens), tokens.length) });
    };
    const asIs = el3("button", { className: "btn secondary", type: "button", textContent: "Save as written" });
    asIs.onclick = () => {
      const text = $2("journalText").value.trim();
      if (!text) return status("Write a little note before saving.");
      saveEntry(text, asIs);
    };
    $2("saveJournal").after(asIs);
    review.onRecord = (text, button) => saveEntry(text, button);
    window.renderJournals = renderJournalList;
    loadJournals();
  }
  function setupDictationTip() {
    const tip = el3(
      "div",
      { className: "dictate-tip" },
      el3("span", { className: "dictate-icon", textContent: "\u{1F399}\uFE0F", ariaHidden: "true" }),
      el3(
        "span",
        {},
        el3("strong", { textContent: "Prefer to talk? " }),
        "Tap the microphone on your phone keyboard and just speak, in English or Arabic. Don\u2019t worry about \u201Cum\u201Ds or changing your mind (\u201Cwait, delete that\u201D). Press \u201CTidy up & review\u201D: we strike through the bits that look like fillers or take-backs, and you decide what stays. You can also edit the text yourself before saving."
      )
    );
    const label = document.querySelector('label[for="journalText"]');
    (label || $2("journalText")).before(tip);
    $2("journalText").setAttribute("dir", "auto");
  }
  function setupReview() {
    const style = document.createElement("style");
    style.textContent = `
.dictate-tip{display:flex;gap:10px;align-items:flex-start;background:#f6f0fc;border:1px solid #e6dcf2;border-radius:14px;padding:11px 13px;margin:4px 0 14px;font-size:13.5px;color:#5b5677;line-height:1.5}
.dictate-icon{font-size:18px;line-height:1.2}
.tidy-review{border:1px solid #d9cde8;background:#fff;border-radius:16px;padding:16px;margin:4px 0 14px}
.tidy-review h3{margin:0 0 4px;font-size:17px}
.tidy-text{font-size:16px;line-height:1.8;white-space:pre-wrap;border:1px solid var(--line,#e8dfed);border-radius:12px;padding:12px 14px;margin:10px 0;background:#fffdfd;max-height:55vh;overflow:auto;cursor:text}
.tidy-del{all:unset;cursor:pointer;color:#c4548c;background:#fde8f2;text-decoration:line-through;text-decoration-color:#ec7fb2;text-decoration-thickness:2px;border-radius:5px;padding:0 2px;-webkit-user-select:text;user-select:text}
.tidy-del.kept{color:inherit;background:#eef5ec;text-decoration:none;outline:1px dashed #9cbf98}
.tidy-del:focus-visible{outline:2px solid #7866a8}
.tidy-legend{font-size:13px;color:#77718a;margin:0}
.tidy-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}`;
    document.head.append(style);
    const panel = el3("div", { className: "tidy-review hidden", ariaLive: "polite" });
    $2("journalText").after(panel);
    const writing = () => [document.querySelector("#journal .dictate-tip"), document.querySelector('label[for="journalText"]'), $2("journalText"), $2("saveJournal")?.parentElement].filter(Boolean);
    const showWriting = (on) => writing().forEach((n2) => n2.classList.toggle("hidden", !on));
    const ctl = { onRecord: null };
    let tokens = [];
    let deletions = [];
    let text = null;
    const finalText = () => applyDeletions(tokens, deletions.filter((d) => !d.kept));
    ctl.close = () => {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      showWriting(true);
    };
    function renderText() {
      text.innerHTML = "";
      const word = (k) => {
        const span = el3("span", { textContent: tokens[k] });
        span.dataset.i = k;
        return span;
      };
      let i = 0;
      deletions.sort((a, b) => a.from - b.from).forEach((d) => {
        for (; i < d.from; i++) text.append(word(i));
        const label = tokens.slice(d.from, d.to + 1).join("").trim();
        const b = el3("button", { type: "button", className: "tidy-del" + (d.kept ? " kept" : ""), title: (d.reason || "Suggested removal") + (d.kept ? " \xB7 tap to remove" : " \xB7 tap to keep") });
        for (let k = d.from; k <= d.to; k++) b.append(word(k));
        b.setAttribute("aria-pressed", String(!!d.kept));
        b.setAttribute("aria-label", `${d.kept ? "Kept" : "Will be removed"}: ${label}. Tap to ${d.kept ? "remove" : "keep"}.`);
        b.onclick = () => {
          if (!getSelection().isCollapsed) return;
          d.kept = !d.kept;
          renderText();
        };
        text.append(b);
        i = d.to + 1;
      });
      for (; i < tokens.length; i++) text.append(word(i));
    }
    function strikeSelection() {
      if (!text || panel.classList.contains("hidden")) return;
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!text.contains(range.commonAncestorContainer)) return;
      const hit = [...text.querySelectorAll("[data-i]")].filter((s) => s.textContent.trim() && range.intersectsNode(s)).map((s) => Number(s.dataset.i));
      if (!hit.length) return;
      let from = Math.min(...hit);
      let to = Math.max(...hit);
      const overlapping = deletions.filter((d) => d.from <= to && d.to >= from);
      overlapping.forEach((d) => {
        from = Math.min(from, d.from);
        to = Math.max(to, d.to);
      });
      deletions = deletions.filter((d) => !overlapping.includes(d));
      deletions.push({ from, to, type: "manual", reason: "You selected this", kept: false });
      sel.removeAllRanges();
      renderText();
    }
    let mouseDown = false;
    let selTimer = null;
    document.addEventListener("pointerdown", (e) => {
      mouseDown = e.pointerType === "mouse";
    });
    document.addEventListener("mouseup", () => {
      if (!mouseDown) return;
      mouseDown = false;
      setTimeout(strikeSelection, 0);
    });
    document.addEventListener("selectionchange", () => {
      if (mouseDown || panel.classList.contains("hidden")) return;
      clearTimeout(selTimer);
      selTimer = setTimeout(strikeSelection, 800);
    });
    ctl.open = (result) => {
      tokens = result.tokens;
      deletions = result.deletions.map((d) => ({ ...d, kept: false }));
      panel.innerHTML = "";
      text = el3("div", { className: "tidy-text", dir: "auto" });
      renderText();
      const legend = "Struck-through parts will be removed. Tap one to keep it, or select any words to strike them out. \u201CEdit text\u201D lets you change anything yourself.";
      const record = el3("button", { className: "btn", type: "button", textContent: "Record this" });
      record.onclick = () => {
        const out = finalText();
        if (!out) return $2("journalStatus").textContent = "Everything was removed. Tap a struck-through part to keep it, or choose \u201CEdit text\u201D.";
        ctl.onRecord?.(out, record);
      };
      const edit = el3("button", { className: "btn secondary", type: "button", textContent: "Edit text" });
      edit.onclick = () => {
        const out = finalText();
        ctl.close();
        $2("journalText").value = out;
        $2("journalText").focus();
        $2("journalStatus").textContent = "Edit as you like, then press \u201CTidy up & review\u201D again or \u201CSave as written\u201D.";
      };
      const back = el3("button", { className: "btn secondary", type: "button", textContent: "Cancel" });
      back.onclick = () => {
        ctl.close();
        $2("journalText").focus();
      };
      panel.append(el3("h3", { textContent: "Review before saving" }), el3("p", { className: "tidy-legend", textContent: legend }), text, el3("div", { className: "tidy-actions" }, record, edit, back));
      showWriting(false);
      $2("journalStatus").textContent = "";
      panel.classList.remove("hidden");
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      record.focus({ preventScroll: true });
    };
    return ctl;
  }
  async function loadJournals() {
    $2("journalEntries").innerHTML = '<p class="empty">Loading your journal\u2026</p>';
    try {
      entries = (await api("/api/journals")).entries;
      renderJournalList();
    } catch (err) {
      $2("journalEntries").innerHTML = "";
      $2("journalEntries").append(el3("p", { className: "empty", textContent: handleApiError(err, "Could not load your journal.") }));
    }
  }
  function renderJournalList() {
    const out = $2("journalEntries");
    out.innerHTML = "";
    renderImportBanner(out);
    if (!entries.length) {
      out.append(el3("p", { className: "empty", textContent: "Your saved journal entries will appear here." }));
      return;
    }
    entries.forEach((entry) => {
      const badge = el3("span", { textContent: entry.shared ? " \xB7 Shared with therapist" : " \xB7 Private" });
      badge.style.cssText = `font-size:12px;font-weight:600;color:${entry.shared ? "#4e7a4c" : "#8a7fa0"}`;
      const toggle = el3("button", { className: "btn secondary small", type: "button", textContent: entry.shared ? "Stop sharing" : "Share with therapist" });
      toggle.onclick = async () => {
        toggle.disabled = true;
        try {
          const { entry: updated } = await api(`/api/journals?id=${encodeURIComponent(entry.id)}`, { method: "PATCH", body: { shared: !entry.shared } });
          Object.assign(entry, updated);
          renderJournalList();
        } catch (err) {
          toggle.disabled = false;
          $2("journalStatus").textContent = handleApiError(err, "Could not update sharing.");
        }
      };
      const del = el3("button", { className: "btn secondary small", type: "button", textContent: "Delete" });
      del.onclick = async () => {
        if (!confirm("Delete this journal entry? This cannot be undone.")) return;
        try {
          await api(`/api/journals?id=${encodeURIComponent(entry.id)}`, { method: "DELETE" });
          entries = entries.filter((x) => x.id !== entry.id);
          renderJournalList();
        } catch (err) {
          $2("journalStatus").textContent = handleApiError(err, "Could not delete.");
        }
      };
      const actions = el3("div", {}, toggle, del);
      actions.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
      out.append(el3(
        "div",
        { className: "result" },
        el3("strong", { textContent: entry.title || "My reflection" }),
        el3("small", { textContent: " \xB7 " + new Date(entry.created).toLocaleString() }),
        badge,
        el3("p", { textContent: entry.text }),
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
    const btn = el3("button", { className: "btn small", type: "button", textContent: `Move ${local.length} to my account` });
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
        $2("journalStatus").textContent = "Your earlier entries are now in your account (not shared).";
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Try again";
        $2("journalStatus").textContent = handleApiError(err, "Could not move entries.");
      }
    };
    const box = el3("div", { className: "result" }, el3("p", { textContent: `You have ${local.length} journal ${local.length === 1 ? "entry" : "entries"} saved only in this browser from before.` }), btn);
    box.style.background = "#fcf9ff";
    out.append(box);
  }
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function setupBooking(user) {
    const form = $2("bookingForm");
    if (!form) return;
    if (user && $2("bookName") && !$2("bookName").value) $2("bookName").value = user.name || "";
    if (user && $2("bookEmail") && !$2("bookEmail").value) $2("bookEmail").value = user.email || "";
    const notice = form.querySelector(".notice");
    if (notice) notice.textContent = "Your enquiry goes straight to the therapist, who will reply by email. You do not need an account. Sending it does not confirm an appointment.";
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Send booking enquiry";
    form.noValidate = true;
    const trap = el3("input", { type: "text", name: "website", tabIndex: -1, autocomplete: "off" });
    trap.setAttribute("aria-hidden", "true");
    trap.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
    form.append(trap);
    const status = (t) => $2("bookingStatus").textContent = t;
    document.addEventListener("submit", async (e) => {
      if (e.target !== form) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const data = Object.fromEntries(new FormData(form));
      const name = (data.name || "").trim();
      const email = (data.email || "").trim();
      if (!name || !email) {
        status(!name && !email ? "Please add your name and an email address, so the therapist can reply to you." : !name ? "Please add your name." : "Please add an email address, so the therapist can reply to you.");
        (!name ? $2("bookName") : $2("bookEmail"))?.focus();
        return;
      }
      if (!EMAIL_RE.test(email)) {
        status("That email address does not look complete. Please check it.");
        $2("bookEmail")?.focus();
        return;
      }
      submitBtn && (submitBtn.disabled = true);
      status("Sending\u2026");
      try {
        await api("/api/bookings", { method: "POST", body: data });
        form.reset();
        if (user) {
          $2("bookName").value = user.name || "";
          $2("bookEmail").value = user.email || "";
        }
        status("Thank you. Your enquiry has been sent. The therapist will reply by email. This is not yet an appointment confirmation.");
        if (!user) askToSignIn("Your enquiry is sent. Want a private journal too?", { signup: true });
      } catch (err) {
        status(err?.status === 401 && !user ? "Could not send right now. Please try again, or email support@safe-spacetherapy.com." : handleApiError(err, "Could not send. Please try again, or email support@safe-spacetherapy.com."));
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
      if (typeof renderSearch === "function") renderSearch($2("searchInput")?.value || "");
    } catch {
    }
  }
  function handleApiError(err, fallback) {
    if (err?.status === 401) {
      if (!signedIn) {
        askToSignIn("Sign in to save this to your account.");
        return "Please sign in first.";
      }
      location.replace(loginUrl("private", "expired"));
      return "Your session has ended. Taking you to sign in\u2026";
    }
    return err?.message || fallback;
  }
  function scrollToHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && document.getElementById(id);
    if (target && target.offsetParent !== null) target.scrollIntoView({ block: "start", behavior: "instant" });
  }
  async function start() {
    if (forwardAuthLinks()) return;
    let user = null;
    try {
      user = await currentUser2();
    } catch {
      user = null;
    }
    if (isDoctor2(user)) return location.replace("doctor.html");
    signedIn = !!user;
    addSharedStyles();
    addAccountMenu(user);
    showDevBanner();
    if (user) setupJournal();
    else setupGuestJournal();
    setupMoodPickers((err) => handleApiError(err, ""), { guest: !user });
    setupBooking(user);
    reveal();
    await Promise.all([setupAffirmations((err) => handleApiError(err, ""), { guest: !user }), loadAffirmations()]);
    refreshAffirmations();
    scrollToHash();
  }
  start();
})();
