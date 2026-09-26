import LibcurlClient from '/libcurl/index.mjs';
import { headerEntries } from './header-utils.mjs';

export default class nyxScramjetLibcurlClient extends LibcurlClient {
  async request(remote, method, body, headers, signal){
    const response=await super.request(remote,method,body,headerEntries(headers),signal);
    return {
      ...response,
      headers:headerEntries(response.headers)
    };
  }

  connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror){
    return super.connect(url,protocols,headerEntries(requestHeaders),onopen,onmessage,onclose,onerror);
  }
}
