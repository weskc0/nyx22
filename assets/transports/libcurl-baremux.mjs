import LibcurlClient from '/libcurl/index.mjs';
import { headerEntries, headerRecord } from './header-utils.mjs';

export default class nyxLibcurlClient extends LibcurlClient {
  async request(remote, method, body, headers, signal){
    const response=await super.request(remote,method,body,headerEntries(headers),signal);
    const normalizedHeaders=headerRecord(response.headers);
    return {
      ...response,
      headers:normalizedHeaders,
      rawHeaders:normalizedHeaders
    };
  }

  connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror){
    return super.connect(url,protocols,headerEntries(requestHeaders),onopen,onmessage,onclose,onerror);
  }
}
