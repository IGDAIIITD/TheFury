declare module 'sockjs-client' {
  interface SocketOptions {
    server?: string;
    transports?: string | string[];
    sessionId?: number | (() => string);
    protocols?: string[];
  }
  class SockJS extends WebSocket {
    constructor(url: string, _reserved?: any, options?: SocketOptions);
  }
  export = SockJS;
}
