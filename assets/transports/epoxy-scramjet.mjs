import EpoxyTransport from '/epoxy/index.mjs';
import { headerEntries, headerRecord } from './header-utils.mjs';

export default class nyxScramjetEpoxyTransport extends EpoxyTransport {
  async request(remote, method, body, headers, signal){
    const response=await super.request(remote,method,body,headerRecord(headers),signal);
    return {
      ...response,
      headers:headerEntries(response.headers)
    };
  }

  connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror){
    return super.connect(url,protocols,headerRecord(requestHeaders),onopen,onmessage,onclose,onerror);
  }
}
