/**
* @file binding-redirect.ts
* @author tngan
* @desc Binding-level API, declare the functions using Redirect binding
*/
import utility from './utility';
import libsaml from './libsaml';
import Entity, { BindingContext } from './entity';
import { IdentityProvider as Idp } from './entity-idp';
import { ServiceProvider as Sp } from './entity-sp';
import * as url from 'url';

import { wording, namespace } from './urn';
import { get } from 'lodash';

const binding = wording.binding;
const urlParams = wording.urlParams;

export interface BuildRedirectConfig {
  baseUrl: string;
  type: string;
  isSigned: boolean;
  context: string;
  entitySetting: any;
  relayState?: string;
}

/**
* @private
* @desc Helper of generating URL param/value pair
* @param  {string} param     key
* @param  {string} value     value of key
* @param  {boolean} first    determine whether the param is the starting one in order to add query header '?'
* @return {string}
*/
function pvPair(param: string, value: string, first?: boolean): string {
  return (first === true ? '?' : '&') + param + '=' + value;
}
/**
* @private
* @desc Refractored part of URL generation for login/logout request
* @param  {string} type
* @param  {boolean} isSigned
* @param  {string} rawSamlRequest
* @param  {object} entitySetting
* @return {string}
*/
function buildRedirectURL(opts: BuildRedirectConfig) {
  const {
    baseUrl,
    type,
    isSigned,
    context,
    entitySetting,
  } = opts;
  let {relayState = '' } = opts;
  const noParams = (url.parse(baseUrl).query || []).length === 0;
  const queryParam = libsaml.getQueryParamByType(type);
  // In general, this xmlstring is required to do deflate -> base64 -> urlencode
  const samlRequest = encodeURIComponent(utility.base64Encode(utility.deflateString(context)));
  if (relayState !== '') {
    relayState = pvPair(urlParams.relayState, encodeURIComponent(relayState));
  }
  if (isSigned) {
    const sigAlg = pvPair(urlParams.sigAlg, encodeURIComponent(entitySetting.requestSignatureAlgorithm));
    const octetString = samlRequest + sigAlg + relayState;
    return baseUrl + pvPair(queryParam, octetString, noParams) + pvPair(urlParams.signature, encodeURIComponent(libsaml.constructMessageSignature(queryParam + '=' + octetString, entitySetting.privateKey, entitySetting.privateKeyPass, null, entitySetting.requestSignatureAlgorithm)));
  }
  return baseUrl + pvPair(queryParam, samlRequest + relayState, noParams);
}
/**
* @desc Redirect URL for login request
* @param  {object} entity                       object includes both idp and sp
* @param  {function} customTagReplacement      used when developers have their own login response template
* @return {string} redirect URL
*/
function loginRequestRedirectURL(entity: { idp: Idp, sp: Sp }, customTagReplacement?: (template: string) => BindingContext): BindingContext {

  const metadata: any = { idp: entity.idp.entityMeta, sp: entity.sp.entityMeta };
  const spSetting: any = entity.sp.entitySetting;
  let id: string = '';

  if (metadata && metadata.idp && metadata.sp) {
    const base = metadata.idp.getSingleSignOnService(binding.redirect);
    let rawSamlRequest: string;
    if (spSetting.loginRequestTemplate) {
      const info = customTagReplacement(spSetting.loginRequestTemplate);
      id = get<string>(info, 'id');
      rawSamlRequest = get<string>(info, 'context');
    } else {
      id = spSetting.generateID();
      rawSamlRequest = libsaml.replaceTagsByValue(libsaml.defaultLoginRequestTemplate.context, {
        ID: id,
        Destination: base,
        Issuer: metadata.sp.getEntityID(),
        IssueInstant: new Date().toISOString(),
        NameIDFormat: namespace.format[spSetting.loginNameIDFormat] || namespace.format.emailAddress,
        AssertionConsumerServiceURL: metadata.sp.getAssertionConsumerService(binding.redirect),
        EntityID: metadata.sp.getEntityID(),
        AllowCreate: spSetting.allowCreate,
      } as any);
    }
    return {
      id,
      context: buildRedirectURL({
        context: rawSamlRequest,
        type: urlParams.samlRequest,
        isSigned: metadata.sp.isAuthnRequestSigned(),
        entitySetting: spSetting,
        baseUrl: base,
      }),
    };
  }
  throw new Error('Missing declaration of metadata');
}
/**
* @desc Redirect URL for logout request
* @param  {object} user                        current logged user (e.g. req.user)
* @param  {object} entity                      object includes both idp and sp
* @param  {function} customTagReplacement     used when developers have their own login response template
* @return {string} redirect URL
*/
function logoutRequestRedirectURL(user, entity, relayState?: string, customTagReplacement?: (template: string) => BindingContext): BindingContext {
  const metadata = { init: entity.init.entityMeta, target: entity.target.entityMeta };
  const initSetting = entity.init.entitySetting;
  let id: string = '';
  if (metadata && metadata.init && metadata.target) {
    const base = metadata.target.getSingleLogoutService(binding.redirect);
    let rawSamlRequest: string = '';
    if (initSetting.logoutRequestTemplate) {
      const info = customTagReplacement(initSetting.logoutRequestTemplate);
      id = get<string>(info, 'id');
      rawSamlRequest = get<string>(info, 'context');
    } else {
      id = initSetting.generateID();
      rawSamlRequest = libsaml.replaceTagsByValue(libsaml.defaultLogoutRequestTemplate.context, {
        ID: id,
        Destination: base,
        EntityID: metadata.init.getEntityID(),
        Issuer: metadata.init.getEntityID(),
        IssueInstant: new Date().toISOString(),
        NameIDFormat: namespace.format[initSetting.logoutNameIDFormat] || namespace.format.emailAddress,
        NameID: user.logoutNameID,
        SessionIndex: user.sessionIndex,
      } as any);
    }
    return {
      id,
      context: buildRedirectURL({
        context: rawSamlRequest,
        relayState,
        type: urlParams.logoutRequest,
        isSigned: entity.target.entitySetting.wantLogoutRequestSigned,
        entitySetting: initSetting,
        baseUrl: base,
      }),
    };
  }
  throw new Error('Missing declaration of metadata');
}
/**
* @desc Redirect URL for logout response
* @param  {object} requescorresponding request, used to obtain the id
* @param  {object} entity                      object includes both idp and sp
* @param  {function} customTagReplacement     used when developers have their own login response template
*/
function logoutResponseRedirectURL(requestInfo: any, entity: any, relayState?: string, customTagReplacement?: (template: string) => BindingContext): BindingContext {
  let id: string = '';
  const metadata = {
    init: entity.init.entityMeta,
    target: entity.target.entityMeta,
  };
  const initSetting = entity.init.entitySetting;
  if (metadata && metadata.init && metadata.target) {
    const base = metadata.target.getSingleLogoutService(binding.redirect);
    let rawSamlResponse;

    if (initSetting.logoutResponseTemplate) {
      const template = customTagReplacement(initSetting.logoutResponseTemplate);
      id = get<string>(template, 'id');
      rawSamlResponse = get<string>(template, 'context');
    } else {
      id = initSetting.generateID();
      const tvalue: any = {
        ID: id,
        Destination: base,
        Issuer: metadata.init.getEntityID(),
        EntityID: metadata.init.getEntityID(),
        IssueInstant: new Date().toISOString(),
        StatusCode: namespace.statusCode.success,
      };
      if (requestInfo && requestInfo.extract && requestInfo.extract.logoutrequest) {
        tvalue.InResponseTo = requestInfo.extract.logoutrequest.id;
      }
      rawSamlResponse = libsaml.replaceTagsByValue(libsaml.defaultLogoutResponseTemplate.context, tvalue);
    }
    return {
      id,
      context: buildRedirectURL({
        baseUrl: base,
        type: urlParams.logoutResponse,
        isSigned: entity.target.entitySetting.wantLogoutResponseSigned,
        context: rawSamlResponse,
        entitySetting: initSetting,
        relayState,
      }),
    };
  }
  throw new Error('Missing declaration of metadata');
}

const redirectBinding = {
  loginRequestRedirectURL,
  logoutRequestRedirectURL,
  logoutResponseRedirectURL,
};

export default redirectBinding;
