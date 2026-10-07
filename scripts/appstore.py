"""Fills in 9jaCut's App Store listing through the App Store Connect API, and
(with --submit) attaches the newest build and submits it for App Review.

Everything comes from mobile/appstore/metadata.json and the screenshots in
mobile/appstore/. Run by .github/workflows/appstore.yml with the same API key
as the TestFlight upload (ASC_KEY_P8 secret + mobile/ios-signing.env).

Results are printed as GitHub annotations (::notice / ::warning / ::error).
Not possible through Apple's API (done once on the website instead):
App Privacy answers.
"""
import base64
import hashlib
import json
import os
import re
import sys
import time

import jwt
import requests

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
META = json.load(open(os.path.join(ROOT, 'mobile', 'appstore', 'metadata.json')))
SUBMIT = '--submit' in sys.argv
API = 'https://api.appstoreconnect.apple.com'
problems = []


log = []


def note(msg):
    log.append(msg)
    print(f'::notice::{msg}', flush=True)


def warn(msg):
    problems.append(msg)
    print(f'::warning::{msg}', flush=True)


def load_key():
    raw = os.environ['ASC_KEY_P8'].replace('\r', '')
    body = re.sub(r'-----(BEGIN|END)[A-Z ]*-----', '', raw)
    body = re.sub(r'[^A-Za-z0-9+/=]', '', body)
    lines = [body[i:i + 64] for i in range(0, len(body), 64)]
    return '-----BEGIN PRIVATE KEY-----\n' + '\n'.join(lines) + '\n-----END PRIVATE KEY-----\n'


KEY = load_key()
_token = {'value': None, 'at': 0}


def token():
    if time.time() - _token['at'] > 600:
        now = int(time.time())
        _token['value'] = jwt.encode(
            {'iss': os.environ['ASC_ISSUER_ID'], 'iat': now, 'exp': now + 1100, 'aud': 'appstoreconnect-v1'},
            KEY, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})
        _token['at'] = time.time()
    return _token['value']


class ApiError(Exception):
    pass


def call(method, path, body=None, ok=(200, 201, 204)):
    url = path if path.startswith('http') else API + path
    r = requests.request(method, url, json=body, headers={'Authorization': f'Bearer {token()}'}, timeout=60)
    if r.status_code not in ok:
        detail = r.text[:900]
        try:
            errs = r.json().get('errors', [])
            detail = ' | '.join(f"{e.get('title')}: {e.get('detail')}" for e in errs)[:900]
        except Exception:
            pass
        raise ApiError(f'{method} {path.split("?")[0]} -> {r.status_code}: {detail}')
    return r.json() if r.content else {}


def step(name, fn):
    try:
        fn()
        note(f'OK: {name}')
        return True
    except ApiError as e:
        warn(f'{name}: {e}')
    except Exception as e:  # keep going; report everything at the end
        warn(f'{name}: {type(e).__name__}: {e}')
    return False


APP = META['appId']
state = {}


def find_version():
    vs = call('GET', f'/v1/apps/{APP}/appStoreVersions?filter[platform]=IOS&limit=20')['data']
    editable = [v for v in vs if v['attributes']['appStoreState'] in (
        'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'READY_FOR_REVIEW', 'UNRESOLVED_ISSUES', 'DEVELOPER_ACTION_NEEDED')]
    if not editable:
        raise ApiError('no editable iOS version: ' + ', '.join(f"{v['attributes']['versionString']}={v['attributes']['appStoreState']}" for v in vs))
    v = editable[0]
    state['version'] = v['id']
    state['versionState'] = v['attributes']['appStoreState']
    note(f"Version {v['attributes']['versionString']} is {state['versionState']}")


def set_version():
    call('PATCH', f"/v1/appStoreVersions/{state['version']}", {'data': {
        'type': 'appStoreVersions', 'id': state['version'],
        'attributes': {'versionString': META['version'], 'copyright': META['copyright'], 'releaseType': META['releaseType']}}})


def version_localization():
    locs = call('GET', f"/v1/appStoreVersions/{state['version']}/appStoreVersionLocalizations")['data']
    loc = next((l for l in locs if l['attributes']['locale'] == META['locale']), locs[0] if locs else None)
    attrs = {'description': META['description'], 'keywords': META['keywords'], 'promotionalText': META['promotionalText'],
             'supportUrl': META['supportUrl'], 'marketingUrl': META['marketingUrl']}
    if loc:
        state['versionLoc'] = loc['id']
        call('PATCH', f"/v1/appStoreVersionLocalizations/{loc['id']}", {'data': {'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': attrs}})
    else:
        r = call('POST', '/v1/appStoreVersionLocalizations', {'data': {'type': 'appStoreVersionLocalizations',
                 'attributes': {'locale': META['locale'], **attrs},
                 'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': state['version']}}}}})
        state['versionLoc'] = r['data']['id']


def app_info():
    infos = call('GET', f'/v1/apps/{APP}/appInfos')['data']
    info = next((i for i in infos if i['attributes'].get('appStoreState') not in ('READY_FOR_SALE', 'REPLACED_WITH_NEW_INFO')
                 and i['attributes'].get('state') not in ('READY_FOR_DISTRIBUTION', 'REPLACED_WITH_NEW_INFO')), infos[0])
    state['appInfo'] = info['id']
    call('PATCH', f"/v1/appInfos/{info['id']}", {'data': {'type': 'appInfos', 'id': info['id'], 'relationships': {
        'primaryCategory': {'data': {'type': 'appCategories', 'id': META['primaryCategory']}},
        'secondaryCategory': {'data': {'type': 'appCategories', 'id': META['secondaryCategory']}}}}})


def app_info_localization():
    locs = call('GET', f"/v1/appInfos/{state['appInfo']}/appInfoLocalizations")['data']
    loc = next((l for l in locs if l['attributes']['locale'] == META['locale']), locs[0])
    call('PATCH', f"/v1/appInfoLocalizations/{loc['id']}", {'data': {'type': 'appInfoLocalizations', 'id': loc['id'], 'attributes': {
        'name': META['name'], 'subtitle': META['subtitle'], 'privacyPolicyUrl': META['privacyPolicyUrl']}}})


# Everything "none / no": a video editor with no web browsing, chat, ads,
# gambling or mature content -> 4+.
AGE_BOOL = {'gambling', 'unrestrictedWebAccess', 'lootBox', 'messagingAndChat', 'parentalControls', 'ageAssurance',
            'userGeneratedContent', 'advertising', 'healthOrWellnessTopics', 'seventeenPlus', 'gamblingAndContests',
            'socialMedia', 'socialMediaAgeRestricted'}
AGE_SKIP = {'gracRatingClassificationNumber', 'kidsAgeBand', 'ageRatingOverride', 'ageRatingOverrideV2', 'koreaAgeRatingOverride', 'developerAgeRatingInfoUrl'}


def age_rating():
    decl = call('GET', f"/v1/appInfos/{state['appInfo']}/ageRatingDeclaration")['data']
    did = decl['id']
    attrs = decl['attributes']
    todo = {}
    for k, v in attrs.items():
        if k in AGE_SKIP:
            continue
        if isinstance(v, bool) or k in AGE_BOOL:
            todo[k] = False
        else:
            todo[k] = 'NONE'
    body = lambda a: {'data': {'type': 'ageRatingDeclarations', 'id': did, 'attributes': a}}
    try:
        call('PATCH', f'/v1/ageRatingDeclarations/{did}', body(todo))
        return
    except ApiError as e:
        warn(f'age rating all at once: {e}')
    failed = []
    for k, v in todo.items():
        for val in (['NONE', False] if v == 'NONE' else [False, 'NONE']):
            try:
                call('PATCH', f'/v1/ageRatingDeclarations/{did}', body({k: val}))
                break
            except ApiError:
                continue
        else:
            failed.append(k)
    if failed:
        raise ApiError('could not set: ' + ', '.join(failed) + ' | current: ' + json.dumps({k: attrs.get(k) for k in failed})[:400])


def content_rights():
    call('PATCH', f'/v1/apps/{APP}', {'data': {'type': 'apps', 'id': APP, 'attributes': {'contentRightsDeclaration': META['contentRights']}}})


def price_free():
    try:
        call('GET', f'/v1/apps/{APP}/appPriceSchedule?include=manualPrices')
        existing = True
    except ApiError:
        existing = False
    pts = call('GET', f'/v1/apps/{APP}/appPricePoints?filter[territory]=USA&limit=200')['data']
    free = next(p for p in pts if float(p['attributes']['customerPrice']) == 0)
    call('POST', '/v1/appPriceSchedules', {'data': {'type': 'appPriceSchedules', 'relationships': {
        'app': {'data': {'type': 'apps', 'id': APP}},
        'baseTerritory': {'data': {'type': 'territories', 'id': 'USA'}},
        'manualPrices': {'data': [{'type': 'appPrices', 'id': '${free}'}]}}},
        'included': [{'type': 'appPrices', 'id': '${free}', 'attributes': {'startDate': None},
                      'relationships': {'appPricePoint': {'data': {'type': 'appPricePoints', 'id': free['id']}}}}]})
    if existing:
        print('replaced the existing price schedule', flush=True)


def availability():
    exclude = set(META['excludeTerritories'])
    terrs = []
    url = '/v1/territories?limit=200'
    while url:
        r = call('GET', url)
        terrs += [t['id'] for t in r['data']]
        url = r.get('links', {}).get('next')
    try:
        av = call('GET', f'/v1/apps/{APP}/appAvailabilityV2')['data']
    except ApiError:
        av = None
    if not av:
        inc = []
        for i, t in enumerate(terrs):
            inc.append({'type': 'territoryAvailabilities', 'id': f'${{t{i}}}', 'attributes': {'available': t not in exclude},
                        'relationships': {'territory': {'data': {'type': 'territories', 'id': t}}}})
        call('POST', '/v2/appAvailabilities', {'data': {'type': 'appAvailabilities', 'attributes': {'availableInNewTerritories': False},
             'relationships': {'app': {'data': {'type': 'apps', 'id': APP}},
                               'territoryAvailabilities': {'data': [{'type': 'territoryAvailabilities', 'id': x['id']} for x in inc]}}},
             'included': inc})
    else:
        url = f"/v2/appAvailabilities/{av['id']}/territoryAvailabilities?include=territory&limit=200"
        while url:
            r = call('GET', url)
            for ta in r['data']:
                t = ta['relationships']['territory']['data']['id']
                want = t not in exclude
                if ta['attributes'].get('available') != want:
                    call('PATCH', f"/v1/territoryAvailabilities/{ta['id']}", {'data': {'type': 'territoryAvailabilities', 'id': ta['id'], 'attributes': {'available': want}}})
            url = r.get('links', {}).get('next')
    note(f'Available in {len([t for t in terrs if t not in exclude])} countries (EU left out until trader status is set)')


def screenshots():
    sets = call('GET', f"/v1/appStoreVersionLocalizations/{state['versionLoc']}/appScreenshotSets")['data']
    dtype = META['screenshotDisplayType']
    s = next((x for x in sets if x['attributes']['screenshotDisplayType'] == dtype), None)
    if s:
        for old in call('GET', f"/v1/appScreenshotSets/{s['id']}/appScreenshots")['data']:
            call('DELETE', f"/v1/appScreenshots/{old['id']}")
    else:
        s = call('POST', '/v1/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': dtype},
                 'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': state['versionLoc']}}}}})['data']
    for name in META['screenshots']:
        data = open(os.path.join(ROOT, 'mobile', 'appstore', name), 'rb').read()
        shot = call('POST', '/v1/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': name, 'fileSize': len(data)},
                    'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': s['id']}}}}})['data']
        for op in shot['attributes']['uploadOperations']:
            part = data[op['offset']:op['offset'] + op['length']]
            hdrs = {h['name']: h['value'] for h in op.get('requestHeaders', [])}
            r = requests.request(op['method'], op['url'], data=part, headers=hdrs, timeout=120)
            if r.status_code >= 300:
                raise ApiError(f'upload of {name} failed: {r.status_code}')
        call('PATCH', f"/v1/appScreenshots/{shot['id']}", {'data': {'type': 'appScreenshots', 'id': shot['id'], 'attributes': {
            'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
    time.sleep(15)
    shots = call('GET', f"/v1/appScreenshotSets/{s['id']}/appScreenshots")['data']
    states = [x['attributes'].get('assetDeliveryState', {}).get('state') for x in shots]
    note(f'{len(shots)} screenshots: {", ".join(str(x) for x in states)}')
    bad = [x['attributes'].get('assetDeliveryState') for x in shots if x['attributes'].get('assetDeliveryState', {}).get('state') == 'FAILED']
    if bad:
        raise ApiError(f'screenshots rejected: {bad[0]}')


def review_details():
    rv = META['review']
    attrs = {'contactFirstName': rv['firstName'], 'contactLastName': rv['lastName'], 'contactEmail': rv['email'],
             'demoAccountRequired': False, 'notes': rv['notes']}
    phone = None  # typed on the website (kept out of this public repo)
    if phone:
        attrs['contactPhone'] = phone
    try:
        cur = call('GET', f"/v1/appStoreVersions/{state['version']}/appStoreReviewDetail")['data']
    except ApiError:
        cur = None
    if cur:
        call('PATCH', f"/v1/appStoreReviewDetails/{cur['id']}", {'data': {'type': 'appStoreReviewDetails', 'id': cur['id'], 'attributes': attrs}})
        has_phone = phone or cur['attributes'].get('contactPhone')
    else:
        call('POST', '/v1/appStoreReviewDetails', {'data': {'type': 'appStoreReviewDetails', 'attributes': attrs,
             'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': state['version']}}}}})
        has_phone = phone
    if not has_phone:
        warn('App Review contact phone number is missing: add it on the website (App Review Information > Contact Information)')


def newest_build(wait):
    deadline = time.time() + (45 * 60 if wait else 0)
    while True:
        bs = call('GET', f"/v1/builds?filter[app]={APP}&filter[preReleaseVersion.version]={META['version']}&limit=50")['data']
        # Highest build number = newest (the API's date sort is not reliable here).
        bs.sort(key=lambda b: int(re.sub(r'\D', '', b['attributes']['version']) or 0), reverse=True)
        if bs:
            b = bs[0]
            st = b['attributes']['processingState']
            if st == 'VALID':
                return b
            if st in ('FAILED', 'INVALID'):
                raise ApiError(f"newest build {b['attributes']['version']} is {st}")
            print(f"build {b['attributes']['version']} is {st}; waiting", flush=True)
        if time.time() > deadline:
            raise ApiError('no processed build yet' + (f" (newest: {bs[0]['attributes']['version']} {bs[0]['attributes']['processingState']})" if bs else ''))
        time.sleep(60)


def attach_build(wait):
    b = newest_build(wait)
    if b['attributes'].get('usesNonExemptEncryption') is None:
        call('PATCH', f"/v1/builds/{b['id']}", {'data': {'type': 'builds', 'id': b['id'], 'attributes': {'usesNonExemptEncryption': False}}})
    call('PATCH', f"/v1/appStoreVersions/{state['version']}/relationships/build", {'data': {'type': 'builds', 'id': b['id']}})
    note(f"Build {b['attributes']['version']} ({META['version']}) attached")


def submit():
    subs = call('GET', f'/v1/reviewSubmissions?filter[app]={APP}&filter[platform]=IOS&limit=20')['data']
    open_sub = next((s for s in subs if s['attributes']['state'] in ('READY_FOR_REVIEW',)), None)
    if any(s['attributes']['state'] in ('WAITING_FOR_REVIEW', 'IN_REVIEW') for s in subs):
        note('Already waiting for / in App Review')
        return
    if not open_sub:
        open_sub = call('POST', '/v1/reviewSubmissions', {'data': {'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'},
                        'relationships': {'app': {'data': {'type': 'apps', 'id': APP}}}}})['data']
    items = call('GET', f"/v1/reviewSubmissions/{open_sub['id']}/items")['data']
    if not items:
        call('POST', '/v1/reviewSubmissionItems', {'data': {'type': 'reviewSubmissionItems', 'relationships': {
            'reviewSubmission': {'data': {'type': 'reviewSubmissions', 'id': open_sub['id']}},
            'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': state['version']}}}}})
    call('PATCH', f"/v1/reviewSubmissions/{open_sub['id']}", {'data': {'type': 'reviewSubmissions', 'id': open_sub['id'], 'attributes': {'submitted': True}}})
    note('SUBMITTED for App Review')


if not step('find the iOS version', find_version):
    sys.exit(1)
if META.get('only') == 'status':
    # Read-only: where the app stands with App Review.
    subs = call('GET', f'/v1/reviewSubmissions?filter[app]={APP}&filter[platform]=IOS&limit=10')['data']
    note('Review submissions: ' + ', '.join(f"{x['attributes']['state']} (submitted {x['attributes'].get('submittedDate')})" for x in subs))
    v = call('GET', f"/v1/appStoreVersions/{state['version']}?include=build")
    note(f"Version {v['data']['attributes']['versionString']}: {v['data']['attributes']['appStoreState']}")
    rd = call('GET', f"/v1/appStoreVersions/{state['version']}/appStoreReviewDetail")['data']['attributes']
    note(f"Review contact set: {bool(rd.get('contactPhone'))}, notes {len(rd.get('notes') or '')} chars")
    print(f"::notice title=Summary::{' || '.join(log)[:3800]}", flush=True)
    sys.exit(0)
if META.get('only') == 'review':
    # Only the App Review contact and notes (e.g. answering an App Review message).
    ok = step('App Review contact and notes', review_details)
    print(f"::{'notice' if ok else 'error'} title=Summary::{' || '.join(log + problems)[:3800]}", flush=True)
    sys.exit(0 if ok else 1)
if state['versionState'] in ('WAITING_FOR_REVIEW', 'IN_REVIEW'):
    note('This version is already with App Review; nothing to change.')
    sys.exit(0)
step('version number, copyright, release after approval', set_version)
step('description, keywords, promotional text, URLs', version_localization)
if step('categories', app_info):
    step('name, subtitle, privacy policy URL', app_info_localization)
    step('age rating (4+)', age_rating)
step('content rights', content_rights)
step('price: free', price_free)
step('countries', availability)
if 'versionLoc' in state:
    step('screenshots', screenshots)
step('App Review contact and notes', review_details)
step('attach the newest build', lambda: attach_build(SUBMIT))


def finish(code):
    parts = log + (['PROBLEMS: ' + ' || '.join(problems)] if problems else [])
    summary = ' || '.join(parts)
    print(f'::error title=Summary::{summary[:3800]}' if code else f'::notice title=Summary::{summary[:3800]}', flush=True)
    sys.exit(code)


if SUBMIT:
    if problems:
        print('::error::Not submitted: fix the warnings above first.')
        finish(1)
    if not step('submit for App Review', submit):
        finish(1)
finish(1 if problems else 0)
