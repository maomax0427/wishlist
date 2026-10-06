# iPhone の共有シート用ショートカット「ほしい物に追加」を作る（署名は macOS の shortcuts sign）
import plistlib, uuid, subprocess, sys

UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
U = lambda: str(uuid.uuid4()).upper()

def out(uid, name):
    return {'Type': 'ActionOutput', 'OutputUUID': uid, 'OutputName': name}
def att(a):
    return {'Value': a, 'WFSerializationType': 'WFTextTokenAttachment'}
def text(s='', a=None):
    v = {'string': s}
    if a is not None:
        v = {'string': '￼', 'attachmentsByRange': {'{0, 1}': a}}
    return {'Value': v, 'WFSerializationType': 'WFTextTokenString'}
def dic(items):
    return {'Value': {'WFDictionaryFieldValueItems': [{'WFItemType': 0, 'WFKey': text(k), 'WFValue': v} for k, v in items]},
            'WFSerializationType': 'WFDictionaryFieldValue'}
INPUT = {'Type': 'ExtensionInput'}

u0, u1, u2, u3, u4, u5, u6 = U(), U(), U(), U(), U(), U(), U()
G = U()
PAGE = {'Type': 'Variable', 'VariableName': 'ページ'}
actions = [
    # 0. 送り先（追加するときに URL を聞かれる）
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
     'WFWorkflowActionParameters': {'UUID': u0, 'WFTextActionText': ''}},
    # 1. 共有されたもの（URL・テキスト・Safari のページ）から URL を取り出す
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.detect.link',
     'WFWorkflowActionParameters': {'UUID': u1, 'WFInput': att(INPUT)}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.getitemfromlist',
     'WFWorkflowActionParameters': {'UUID': u2, 'WFInput': att(out(u1, 'URL')), 'WFItemSpecifier': 'First Item'}},
    # 2. URL があれば iPhone で商品ページを読む（Amazon やボット対策のある公式通販でも読める）
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.conditional',
     'WFWorkflowActionParameters': {'GroupingIdentifier': G, 'WFControlFlowMode': 0, 'WFCondition': 100,
                                    'WFInput': {'Type': 'Variable', 'Variable': att(out(u2, 'Item from List'))}}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
     'WFWorkflowActionParameters': {'UUID': u3, 'WFURL': text(a=out(u2, 'Item from List')), 'WFHTTPMethod': 'GET', 'ShowHeaders': True,
                                    'WFHTTPHeaders': dic([('User-Agent', text(UA)), ('Accept-Language', text('ja-JP,ja;q=0.9'))])}},
    # 3. 文字化けしないように中身をそのまま Base64 で送る
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.base64encode',
     'WFWorkflowActionParameters': {'UUID': u4, 'WFInput': att(out(u3, 'Contents of URL')), 'WFEncodeMode': 'Encode', 'WFBase64LineBreakMode': 'None'}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.setvariable',
     'WFWorkflowActionParameters': {'WFVariableName': 'ページ', 'WFInput': att(out(u4, 'Base64 Encoded'))}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.conditional',
     'WFWorkflowActionParameters': {'GroupingIdentifier': G, 'WFControlFlowMode': 2}},
    # 4. Apps Script に送って登録（URL が見つからなくても共有テキストを送る）
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
     'WFWorkflowActionParameters': {'UUID': u5, 'WFURL': text(a=out(u0, 'Text')), 'WFHTTPMethod': 'POST', 'WFHTTPBodyType': 'JSON', 'ShowHeaders': False,
                                    'WFJSONValues': dic([('action', text('add')), ('url', text(a=out(u2, 'Item from List'))),
                                                         ('text', text(a=INPUT)), ('html64', text(a=PAGE))])}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.getvalueforkey',
     'WFWorkflowActionParameters': {'UUID': u6, 'WFInput': att(out(u5, 'Contents of URL')), 'WFDictionaryKey': 'message', 'WFGetDictionaryValueType': 'Value'}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.notification',
     'WFWorkflowActionParameters': {'WFNotificationActionTitle': text('ほしい物リスト'), 'WFNotificationActionBody': text(a=out(u6, 'Dictionary Value')), 'WFNotificationActionSound': True}},
]
wf = {
    'WFWorkflowActions': actions,
    'WFWorkflowClientVersion': '3218.0.4.100',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59446},
    'WFWorkflowImportQuestions': [{'ActionIndex': 0, 'Category': 'Parameter', 'DefaultValue': '', 'ParameterKey': 'WFTextActionText',
                                   'Text': 'ほしい物リストの 設定 → 連携 で使っている Apps Script の URL（https://script.google.com/…/exec）を貼ってください'}],
    'WFWorkflowInputContentItemClasses': ['WFURLContentItem', 'WFSafariWebPageContentItem', 'WFStringContentItem', 'WFRichTextContentItem'],
    'WFWorkflowOutputContentItemClasses': [],
    'WFWorkflowTypes': ['ActionExtension'],
    'WFQuickActionSurfaces': [],
    'WFWorkflowHasOutputFallback': False,
}
if len(sys.argv) > 1:   # URL を埋め込んで作る（追加時の質問なし）
    actions[0]['WFWorkflowActionParameters']['WFTextActionText'] = sys.argv[1]
    wf['WFWorkflowImportQuestions'] = []
with open('unsigned.shortcut', 'wb') as f:
    plistlib.dump(wf, f, fmt=plistlib.FMT_BINARY)
r = subprocess.run(['shortcuts', 'sign', '-m', 'anyone', '-i', 'unsigned.shortcut', '-o', 'ほしい物に追加.shortcut'], capture_output=True, text=True)
print(r.returncode, r.stdout, r.stderr)
