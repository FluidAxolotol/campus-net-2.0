// ============================================================
// 统一请求入口
// 所有页面都走这里：JSON 序列化、CSRF 头、错误转 ApiError、
// 401 统一事件、文件上传进度。
// ============================================================

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let csrfToken = null;

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || '请求失败');
    this.name = 'ApiError';
    this.status = status;
    this.code = payload?.error?.code || 'UNKNOWN';
    this.details = payload?.error?.details || null;
    this.requestId = payload?.error?.requestId || '';
  }
}

async function readPayload(response) {
  const type = response.headers.get('content-type') || '';
  if (response.status === 204) return null;
  if (type.includes('application/json')) {
    return response.json().catch(() => null);
  }
  return { rawText: await response.text() };
}

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/csrf', { credentials: 'same-origin' });
  const payload = await readPayload(response);
  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }
  csrfToken = payload?.data?.token || null;
  return csrfToken;
}

async function request(method, path, options = {}) {
  const {
    body,
    headers = {},
    raw = false,
    retried = false,
  } = options;

  const finalHeaders = { Accept: 'application/json', ...headers };
  const init = {
    method,
    credentials: 'same-origin',
    headers: finalHeaders,
  };

  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body; // 浏览器自动带 multipart boundary
    } else {
      finalHeaders['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  if (!SAFE_METHODS.has(method)) {
    finalHeaders['X-CSRF-Token'] = await ensureCsrfToken();
  }

  const response = await fetch(path, init);
  const payload = await readPayload(response);

  if (!response.ok) {
    // 页面长期不刷新时，CSRF Cookie 可能过期；清缓存重取一次
    if (
      response.status === 403
      && payload?.error?.code === 'CSRF_INVALID'
      && !retried
    ) {
      csrfToken = null;
      return request(method, path, { ...options, retried: true });
    }

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('api:unauthorized', {
        detail: { path },
      }));
    }
    throw new ApiError(response.status, payload);
  }

  // 列表接口要读 meta，所以 raw=true 时返回整个 { data, meta }
  return raw ? payload : (payload?.data ?? payload);
}

export const api = {
  get(path, options) {
    return request('GET', path, options);
  },
  getRaw(path) {
    return request('GET', path, { raw: true });
  },
  post(path, body, options) {
    return request('POST', path, { body, ...options });
  },
  patch(path, body, options) {
    return request('PATCH', path, { body, ...options });
  },
  delete(path, options) {
    return request('DELETE', path, options);
  },
  csrf() {
    return ensureCsrfToken();
  },

  /**
   * 文件上传用 XHR：fetch 没有标准的 upload.onprogress，
   * 拿不到可靠的 loaded/total，做不了进度条。
   */
  upload(path, formData, { onProgress } = {}) {
    return ensureCsrfToken().then((token) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', path, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-CSRF-Token', token);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onProgress === 'function') {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        let payload = null;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch {
          payload = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload?.data ?? payload);
        } else {
          reject(new ApiError(xhr.status, payload));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, {
        error: { code: 'NETWORK_ERROR', message: '网络连接失败' },
      }));
      xhr.send(formData);
    }));
  },

  /**
   * 下载文件：用 fetch 先确认鉴权结果，
   * 避免未登录时把一段 JSON 错误当成文件下载。
   */
  async download(path, fallbackName = 'download') {
    const response = await fetch(path, { credentials: 'same-origin' });
    const type = response.headers.get('content-type') || '';
    if (!response.ok) {
      const payload = type.includes('application/json')
        ? await response.json().catch(() => null)
        : null;
      throw new ApiError(response.status, payload);
    }

    const disposition = response.headers.get('content-disposition') || '';
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const simpleMatch = disposition.match(/filename="([^"]+)"/i);
    const filename = utf8Match
      ? decodeURIComponent(utf8Match[1])
      : (simpleMatch?.[1] || fallbackName);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  },
};

export default api;
