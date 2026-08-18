import{j as e,c as x,v as K,w as V,r as f,B as L}from"./index-CXSvQytt.js";import{c as N}from"./createLucideIcon-D68yoFtf.js";/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const G=[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]],D=N("Check",G);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I=[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]],J=N("ChevronRight",I);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const z=[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]],F=N("Copy",z),H=K("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",{variants:{variant:{default:"border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",secondary:"border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",destructive:"border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",outline:"text-foreground"}},defaultVariants:{variant:"default"}});function S({className:t,variant:n,...r}){return e.jsx("div",{className:x(H({variant:n}),t),...r})}const U=[{id:"curl",label:"cURL"},{id:"python",label:"Python"},{id:"javascript",label:"JavaScript"}],u="sk-fab-0123456789abcdef0123456789abcdef",j=`{
  "id": "chatcmpl-01",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "def fib(n):\\n    a, b = 0, 1\\n    for _ in range(n):\\n        a, b = b, a + b\\n    return a"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 42,
    "total_tokens": 70
  }
}`,k=`{
  "id": "msg_01",
  "type": "message",
  "role": "assistant",
  "model": "claude-haiku-4",
  "content": [
    {
      "type": "text",
      "text": "def fib(n):\\n    a, b = 0, 1\\n    for _ in range(n):\\n        a, b = b, a + b\\n    return a"
    }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 24,
    "output_tokens": 40
  }
}`,Y={id:"chat",title:"对话补全",protocol:"OpenAI Chat Completions",method:"POST",path:"/v1/chat/completions",summary:"OpenAI 兼容对话补全。网关原样转发请求体，只读 model / stream。",description:"调用方只持虚拟钥匙（发放为 `sk-fab-`，种子钥匙为 `sk-fabric-demo`）。网关按请求 `model` 查 Model 映射与价格，再把正文透传到对应 Provider。同一把 VK 也可以打 `/v1/messages`，但两个端点互不转换。",auth:[{name:"Authorization",type:"string",required:!0,description:"标准 HTTP Bearer。值为虚拟钥匙明文，例如 `Bearer sk-fab-…`。也可用请求头 `x-api-key` 传同一把钥匙。缺钥匙返回 401 `missing_virtual_key`；哈希对不上或已停用返回 401 `invalid_virtual_key`。"}],headers:[{name:"Content-Type",type:"string",required:!0,defaultValue:"application/json",description:"请求体为 JSON。"},{name:"x-api-key",type:"string",description:"与 `Authorization: Bearer` 二选一。若同时存在，优先读 Bearer。"},{name:"x-fabric-context",type:"string",description:"可选 JSON。网关只认 `project_id`、`task_type`、`run_id`。`project_id` 若填必须与 VK 所属 Project 一致，否则 400 `project_mismatch`。非法 JSON 返回 400 `bad_fabric_context`。`run_id` / `task_type` 写入请求流水，不送到上游。"}],body:[{name:"model",type:"string",required:!0,description:"调用的模型名。必须已在 Model 映射中、未停用、family 为 `openai`，且价格表有行。否则 400 `unknown_model` 或 `no_price`。缺字段或非法 JSON 返回 `missing_model`。"},{name:"messages",type:"object[]",required:!0,description:"对话上下文。网关不解析、不改写，原样交给上游。",children:[{name:"role",type:"enum<string>",required:!0,description:"`system` / `user` / `assistant` / `tool`。以上游约定为准。"},{name:"content",type:"string | object[]",required:!0,description:"文本，或上游支持的多模态内容块。网关透传。"},{name:"name",type:"string",description:"可选。参与者名称。"},{name:"tool_calls",type:"object[]",description:"助手消息里的工具调用。网关不翻译协议。"}]},{name:"stream",type:"boolean",defaultValue:"false",description:"`false`：等完整响应一次返回。`true`：按上游 SSE 原样流式写出，客户端断开即停上游。"},{name:"temperature",type:"number",description:"采样温度，透传给上游。"},{name:"top_p",type:"number",description:"核采样，透传给上游。"},{name:"max_tokens",type:"integer",description:"生成上限。部分上游用 `max_completion_tokens`。网关原样转发字段名。"},{name:"tools",type:"object[]",description:"函数 / 工具定义，透传。不要指望网关把 OpenAI tools 翻成 Anthropic tools。"},{name:"tool_choice",type:"string | object",description:"工具选择策略（如 `auto` / `none` / 指定函数），透传。"},{name:"stop",type:"string | string[]",description:"停止词，透传。"},{name:"response_format",type:"object",description:'如 `{ "type": "json_object" }`。是否生效取决于上游模型。'}],response:[{name:"id",type:"string",description:"上游补全 ID，网关不改写。"},{name:"model",type:"string",description:"实际上游使用的模型。"},{name:"choices",type:"object[]",description:"补全结果。结构与上游一致。",children:[{name:"index",type:"integer",description:"候选项序号。"},{name:"message",type:"object",description:"`role` + `content`，以及上游可能返回的 `tool_calls` 等字段。"},{name:"finish_reason",type:"string",description:"如 `stop`、`length`、`tool_calls`。"}]},{name:"usage",type:"object",description:"厂家 Token 用量。网关用 `prompt_tokens` / `completion_tokens`（或 Anthropic 的 `input_tokens` / `output_tokens`）记入请求流水并按价格表算 CNY。",children:[{name:"prompt_tokens",type:"integer",description:"输入 Token。"},{name:"completion_tokens",type:"integer",description:"输出 Token。"},{name:"total_tokens",type:"integer",description:"合计。网关记账不依赖此字段。"}]}]},W={id:"messages",title:"Messages",protocol:"Anthropic Messages",method:"POST",path:"/v1/messages",summary:"Anthropic 兼容消息接口。网关原样转发，不把 OpenAI 请求翻译过来。",description:"用同一把 `sk-fab-` 虚拟钥匙。Claude Code / Anthropic SDK 的 Base URL 填网关根地址（不要带 `/v1`），SDK 会请求 `/v1/messages`。`model` 必须映射到 family 为 `anthropic` 的 Provider。",auth:[{name:"x-api-key",type:"string",required:!0,description:"虚拟钥匙明文，例如 `sk-fab-…`。也可用 `Authorization: Bearer sk-fab-…`。Bearer 优先。"}],headers:[{name:"Content-Type",type:"string",required:!0,defaultValue:"application/json",description:"请求体为 JSON。"},{name:"anthropic-version",type:"string",description:"调用方可带。出站时由 Live Provider 补官方 Key 与协议头，不依赖调用方官方 Key。"},{name:"x-fabric-context",type:"string",description:"与对话补全相同。`project_id` / `task_type` / `run_id`。"}],body:[{name:"model",type:"string",required:!0,description:"Anthropic 模型名。必须已映射且 family 为 `anthropic`，并有价格。"},{name:"max_tokens",type:"integer",required:!0,description:"Anthropic 协议必填的输出上限。网关透传，不代填。"},{name:"messages",type:"object[]",required:!0,description:"轮次消息。角色通常是 `user` / `assistant`。系统提示请放 `system`。",children:[{name:"role",type:"enum<string>",required:!0,description:"`user` 或 `assistant`。"},{name:"content",type:"string | object[]",required:!0,description:"文本或内容块数组，透传。"}]},{name:"system",type:"string | object[]",description:"系统提示，透传。"},{name:"stream",type:"boolean",defaultValue:"false",description:"SSE 透传。断开客户端即停上游。"},{name:"temperature",type:"number",description:"透传给上游。"},{name:"top_p",type:"number",description:"透传给上游。"},{name:"tools",type:"object[]",description:"Anthropic 工具定义，透传。不要发 OpenAI 形态的 tools。"}],response:[{name:"id",type:"string",description:"上游消息 ID。"},{name:"type",type:"string",description:"一般为 `message`。"},{name:"role",type:"string",description:"`assistant`。"},{name:"content",type:"object[]",description:'内容块，常见 `{ "type": "text", "text": "..." }`。'},{name:"stop_reason",type:"string",description:"如 `end_turn`、`max_tokens`、`tool_use`。"},{name:"usage",type:"object",description:"网关用 `input_tokens` / `output_tokens` 记流水。",children:[{name:"input_tokens",type:"integer",description:"输入 Token。"},{name:"output_tokens",type:"integer",description:"输出 Token。"}]}]},Q=[{status:401,code:"missing_virtual_key",when:"请求没有 `Authorization: Bearer`，也没有 `x-api-key`。",sample:'{"error":"missing_virtual_key"}'},{status:401,code:"invalid_virtual_key",when:"钥匙哈希对不上，或对应 VK 已停用。",sample:'{"error":"invalid_virtual_key"}'},{status:400,code:"bad_fabric_context",when:"`x-fabric-context` 不是合法 JSON。",sample:'{"error":"bad_fabric_context"}'},{status:400,code:"project_mismatch",when:"`x-fabric-context.project_id` 与该 VK 所属 Project 不一致。",sample:'{"error":"project_mismatch"}'},{status:400,code:"missing_model",when:"请求体不是 JSON，或没有 `model`。",sample:'{"error":"missing_model"}'},{status:400,code:"unknown_model",when:"模型未登记、已停用、Provider 已停用，或 family 与端点不符（OpenAI 端点打了 Anthropic 模型）。",sample:'{"error":"unknown_model"}'},{status:400,code:"no_price",when:"模型已登记但价格表没有对应行。",sample:'{"error":"no_price"}'},{status:502,code:"provider",when:"出站请求失败（连不上上游或解密 Provider Key 失败）。上游自己的 4xx/5xx 会原样回传，不走这条。",sample:'{"error":"provider"}'},{status:401,code:"unauthorized",when:"控制台接口缺少或过期 `fabric_session` Cookie。",sample:'{"error":"unauthorized"}'},{status:401,code:"invalid_credentials",when:"登录用户名或密码不对。",sample:'{"error":"invalid_credentials"}'},{status:404,code:"not_found",when:"按 hash / name / model 找不到对象，或路径未注册。",sample:'{"error":"not_found"}'},{status:409,code:"duplicate",when:"创建 Provider 或 Model 时名称已存在。",sample:'{"error":"duplicate"}'}];function X(t,n){const r=n.replace(/\/$/,"");return t==="messages"?ee(r):Z(r)}function Z(t){return{curl:{request:`curl --request POST \\
  --url ${`${t}/v1/chat/completions`} \\
  --header 'Authorization: Bearer ${u}' \\
  --header 'Content-Type: application/json' \\
  --data '
{
  "model": "gpt-4o-mini",
  "messages": [
    {
      "role": "system",
      "content": "你是编程助手，擅长写简洁高效的代码。"
    },
    {
      "role": "user",
      "content": "写一个 Python 函数，计算斐波那契数列第 n 项。"
    }
  ],
  "temperature": 1,
  "stream": false
}
'`,response:j},python:{request:`from openai import OpenAI

client = OpenAI(
    api_key="${u}",
    base_url="${t}/v1",
)

resp = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "你是编程助手，擅长写简洁高效的代码。"},
        {"role": "user", "content": "写一个 Python 函数，计算斐波那契数列第 n 项。"},
    ],
    temperature=1,
    stream=False,
)
print(resp.choices[0].message.content)`,response:j},javascript:{request:`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${u}",
  baseURL: "${t}/v1",
});

const resp = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: "你是编程助手，擅长写简洁高效的代码。" },
    { role: "user", content: "写一个 Python 函数，计算斐波那契数列第 n 项。" },
  ],
  temperature: 1,
  stream: false,
});
console.log(resp.choices[0].message.content);`,response:j}}}function ee(t){return{curl:{request:`curl --request POST \\
  --url ${`${t}/v1/messages`} \\
  --header 'x-api-key: ${u}' \\
  --header 'Content-Type: application/json' \\
  --data '
{
  "model": "claude-haiku-4",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "写一个 Python 函数，计算斐波那契数列第 n 项。"
    }
  ],
  "stream": false
}
'`,response:k},python:{request:`import anthropic

client = anthropic.Anthropic(
    api_key="${u}",
    base_url="${t}",
)

msg = client.messages.create(
    model="claude-haiku-4",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "写一个 Python 函数，计算斐波那契数列第 n 项。"},
    ],
)
print(msg.content[0].text)`,response:k},javascript:{request:`import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "${u}",
  baseURL: "${t}",
});

const msg = await client.messages.create({
  model: "claude-haiku-4",
  max_tokens: 1024,
  messages: [
    { role: "user", content: "写一个 Python 函数，计算斐波那契数列第 n 项。" },
  ],
});
console.log(msg.content[0].text);`,response:k}}}const te=[{name:"Cookie",type:"string",required:!0,description:"登录接口下发的 `fabric_session`。缺失或过期返回 401 `unauthorized`。"}],se=[{name:"Content-Type",type:"string",required:!0,defaultValue:"application/json",description:"请求体为 JSON。"}];function s(t,n,r,d={}){return{name:t,type:n,description:r,...d}}function a(t,n,r,d,c,o){const i=o.cookie!==!1;return{id:t,title:n,method:r,path:d,summary:c,description:o.description??(i?"需要已登录的 `fabric_session` Cookie。":"无需鉴权。"),adminOnly:o.adminOnly,auth:i?te:[],headers:o.headers??(r==="GET"||r==="DELETE"?[]:se),query:o.query,body:o.body??[],response:o.response,exampleBody:o.exampleBody,exampleResponse:o.exampleResponse,cookie:i}}const E=[s("name","string","Project 名称，唯一。")],P=[s("hash","string","虚拟钥匙的 SHA-256 hex，列表与查询只回这个。"),s("project","string","所属 Project。"),s("disabled","boolean","停用后网关返回 `invalid_virtual_key`。")],w=[s("name","string","Provider 名称，唯一。"),s("family","enum<string>","`openai` 或 `anthropic`。"),s("base_url","string","上游根地址，不含路径。"),s("disabled","boolean","停用后挂在它下面的 Model 视为不可用。")],ne=[s("name","string","请求里的 model 名。"),s("family","enum<string>","`openai` 或 `anthropic`，须与 Provider 一致。"),s("provider","string","绑定的 Provider 名。"),s("disabled","boolean","停用后网关返回 `unknown_model`。")],O=[s("model","string","对应已登记的 model。"),s("input_cny","number","每百万 input Token 的人民币成本价。"),s("output_cny","number","每百万 output Token 的人民币成本价。"),s("cached_cny","number","每百万 cached Token 的人民币成本价。")],re=a("health","健康检查","GET","/health","网关存活探测。",{cookie:!1,description:"进程健康检查。不探测数据库。无需鉴权。",response:[s("ok","boolean","进程起来即为 true。"),s("service","string","固定 `fabric`。")],exampleResponse:{ok:!0,service:"fabric"}}),oe=a("login","登录","POST","/admin/api/login","用户名 + 密码换 Session。",{cookie:!1,description:"校验通过后写 HttpOnly Cookie `fabric_session`。种子账号 `admin` / `fabric-admin`。",body:[s("username","string","管理员用户名。",{required:!0}),s("password","string","密码。",{required:!0})],response:[s("status","string","固定 `ok`。"),s("username","string","登录用户名。")],exampleBody:{username:"admin",password:"fabric-admin"},exampleResponse:{status:"ok",username:"admin"}}),ie=a("logout","退出","POST","/admin/api/logout","吊销当前 Session。",{cookie:!1,description:"清除 `fabric_session`。没有 Cookie 也返回成功。",headers:[],response:[s("status","string","固定 `ok`。")],exampleResponse:{status:"ok"}}),ae=a("me","当前用户","GET","/admin/api/me","读取登录身份。",{response:[s("username","string","登录用户名。"),s("name","string","当前等于 username。"),s("role","string","固定 `admin`。")],exampleResponse:{username:"admin",name:"admin",role:"admin"}}),de=a("list-projects","项目列表","GET","/admin/api/projects","列出全部 Project。",{response:[s("projects","object[]","项目数组。",{children:E})],exampleResponse:{projects:[{name:"demo"}]}}),ce=a("create-project","创建项目","POST","/admin/api/projects","新建 Project。",{body:[s("name","string","项目名，不能为空。",{required:!0})],response:E,exampleBody:{name:"billing"},exampleResponse:{name:"billing"}}),le=a("list-virtual-keys","虚拟钥匙列表","GET","/admin/api/virtual-keys","列出全部 VK 元数据，不含明文。",{response:[s("keys","object[]","不含明文。",{children:P})],exampleResponse:{keys:[{hash:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",project:"demo",disabled:!1}]}}),pe=a("create-virtual-key","发放虚拟钥匙","POST","/admin/api/virtual-keys","为已有 Project 发一把 VK。明文只在这次响应里出现。",{body:[s("project","string","已存在的 Project 名。",{required:!0})],response:[...P,s("plaintext","string","明文，前缀 `sk-fab-`，只此一次。")],exampleBody:{project:"demo"},exampleResponse:{hash:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",project:"demo",disabled:!1,plaintext:u}}),me=a("get-virtual-key","虚拟钥匙详情","GET","/admin/api/virtual-keys/{hash}","按 hash 读一把 VK，不含明文。",{response:P,exampleResponse:{hash:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",project:"demo",disabled:!1}}),ue=a("disable-virtual-key","停用虚拟钥匙","POST","/admin/api/virtual-keys/{hash}/disable","停用后该明文再打网关会 401。",{headers:[],response:[s("status","string","固定 `disabled`。")],exampleResponse:{status:"disabled"}}),xe=a("list-providers","Provider 列表","GET","/admin/api/providers","列出上游 Provider 元数据，不含官方 Key。",{response:[s("providers","object[]","不含 api_key。",{children:w})],exampleResponse:{providers:[{name:"deepseek",family:"openai",base_url:"https://api.deepseek.com",disabled:!1}]}}),he=a("create-provider","录入 Provider","POST","/admin/api/providers","加密入库一把官方 Key。明文只在请求里出现一次。",{description:"需要已登录 Session。`api_key` 用 AES-GCM 加密后入库，响应永不回 secret。",body:[s("name","string","名称，唯一。",{required:!0}),s("family","enum<string>","`openai` 或 `anthropic`。",{required:!0}),s("base_url","string","上游根地址。",{required:!0}),s("api_key","string","官方 Key 明文。",{required:!0})],response:w,exampleBody:{name:"deepseek",family:"openai",base_url:"https://api.deepseek.com",api_key:"sk-upstream-secret"},exampleResponse:{name:"deepseek",family:"openai",base_url:"https://api.deepseek.com",disabled:!1}}),ge=a("get-provider","Provider 详情","GET","/admin/api/providers/{name}","按名称读取，不含官方 Key。",{response:w,exampleResponse:{name:"deepseek",family:"openai",base_url:"https://api.deepseek.com",disabled:!1}}),be=a("disable-provider","停用 Provider","POST","/admin/api/providers/{name}/disable","停用后挂在它下面的 Model 视为 `unknown_model`。",{headers:[],response:[s("status","string","固定 `disabled`。")],exampleResponse:{status:"disabled"}}),fe=a("list-models","Model 列表","GET","/admin/api/models","列出全部 Model 映射。",{response:[s("models","object[]","模型映射。",{children:ne})],exampleResponse:{models:[{name:"gpt-4o-mini",family:"openai",provider:"deepseek",disabled:!1}]}}),ye=a("create-model","登记 Model","POST","/admin/api/models","把请求 model 绑到一个已有 Provider。",{body:[s("name","string","请求里的 model 名。",{required:!0}),s("family","enum<string>","须与 Provider 的 family 一致。",{required:!0}),s("provider","string","已存在的 Provider 名。",{required:!0})],response:[s("name","string","模型名。"),s("family","string","协议族。"),s("provider","string","Provider。")],exampleBody:{name:"gpt-4o-mini",family:"openai",provider:"deepseek"},exampleResponse:{name:"gpt-4o-mini",family:"openai",provider:"deepseek"}}),je=a("disable-model","停用 Model","POST","/admin/api/models/{name}/disable","停用后网关对该 model 返回 `unknown_model`。",{headers:[],response:[s("status","string","固定 `disabled`。")],exampleResponse:{status:"disabled"}}),ke=a("list-prices","价格列表","GET","/admin/api/prices","列出全部成本价。",{response:[s("prices","object[]","按百万 Token 计的人民币价。",{children:O})],exampleResponse:{prices:[{model:"gpt-4o-mini",input_cny:1,output_cny:2,cached_cny:.1}]}}),_e=a("upsert-price","写入价格","PUT","/admin/api/prices/{model}","为已登记 Model 写入或覆盖成本价。",{body:[s("input_cny","number","每百万 input Token，人民币。",{required:!0}),s("output_cny","number","每百万 output Token，人民币。",{required:!0}),s("cached_cny","number","每百万 cached Token，人民币。",{required:!0})],response:O,exampleBody:{input_cny:1,output_cny:2,cached_cny:.1},exampleResponse:{model:"gpt-4o-mini",input_cny:1,output_cny:2,cached_cny:.1}}),ve=a("delete-price","删除价格","DELETE","/admin/api/prices/{model}","删掉后该 model 再打网关会 400 `no_price`。",{headers:[],response:[s("status","string","固定 `deleted`。")],exampleResponse:{status:"deleted"}}),Ne=a("usage","用量聚合","GET","/admin/api/usage","按 Project × Model × 日聚合。日界为 Asia/Shanghai。",{query:[s("day","string","YYYY-MM-DD。缺省为上海时区今天。"),s("project","string","按 Project 过滤。空则全部。")],response:[s("day","string","查询的日。"),s("project","string","查询的 Project 过滤，空为全部。"),s("rows","object[]","聚合行。",{children:[s("project","string","Project。"),s("model","string","Model。"),s("day","string","上海时区日。"),s("calls","integer","总调用。"),s("failed_calls","integer","HTTP 失败。"),s("zero_usage_calls","integer","上游没回 usage 的次数。"),s("input_tokens","integer","输入 Token。"),s("output_tokens","integer","输出 Token。"),s("cached_tokens","integer","缓存 Token。"),s("cost_cny","number","按价格表算出的人民币成本。")]})],exampleResponse:{project:"",day:"2026-08-18",rows:[{project:"demo",model:"gpt-4o-mini",day:"2026-08-18",calls:3,failed_calls:0,zero_usage_calls:0,input_tokens:84,output_tokens:126,cached_tokens:0,cost_cny:336e-6}]}}),Pe=a("requests","请求流水","GET","/admin/api/requests","列出某 Project 的请求流水（账本粒度）。",{query:[s("project","string","Project 名。缺省为种子项目 `demo`。")],response:[s("project","string","查询的 Project。"),s("requests","object[]","流水。",{children:[s("virtual_key_hash","string","VK 哈希。"),s("project","string","Project。"),s("model","string","请求 model。"),s("input_tokens","integer","输入。"),s("output_tokens","integer","输出。"),s("cached_tokens","integer","缓存。"),s("cost_cny","number","本次成本。"),s("status","integer","回给调用方的 HTTP 状态。"),s("run_id","string","来自 `x-fabric-context.run_id`，未传则为空。"),s("task_type","string","来自 `x-fabric-context.task_type`。")]})],exampleResponse:{project:"demo",requests:[{virtual_key_hash:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",project:"demo",model:"gpt-4o-mini",input_tokens:28,output_tokens:42,cached_tokens:0,cost_cny:112e-6,status:200,run_id:"run-1",task_type:"chat"}]}}),_=[{title:"模型 API",items:[{kind:"api",doc:Y},{kind:"api",doc:W}]},{title:"系统",items:[{kind:"api",doc:re}]},{title:"账号",items:[{kind:"api",doc:oe},{kind:"api",doc:ie},{kind:"api",doc:ae}]},{title:"项目",items:[{kind:"api",doc:de},{kind:"api",doc:ce}]},{title:"虚拟钥匙",items:[{kind:"api",doc:le},{kind:"api",doc:pe},{kind:"api",doc:me},{kind:"api",doc:ue}]},{title:"上游 Provider",items:[{kind:"api",doc:xe},{kind:"api",doc:he},{kind:"api",doc:ge},{kind:"api",doc:be}]},{title:"Model 映射",items:[{kind:"api",doc:fe},{kind:"api",doc:ye},{kind:"api",doc:je}]},{title:"价格与用量",items:[{kind:"api",doc:ke},{kind:"api",doc:_e},{kind:"api",doc:ve},{kind:"api",doc:Ne},{kind:"api",doc:Pe}]},{title:"参考",items:[{kind:"page",id:"errors",title:"鉴权与错误"}]}],we=_.flatMap(t=>t.items.filter(n=>n.kind==="api").map(n=>n.doc));function A(t){return we.find(n=>n.id===t)}const v="chat";function Te(t,n){const r=n.replace(/\/$/,""),d=t.path.replace("{hash}","9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08").replace("{name}","deepseek").replace("{model}","gpt-4o-mini"),c=`${r}${d}`,o=t.exampleBody?JSON.stringify(t.exampleBody,null,2):"",i=JSON.stringify(t.exampleResponse??{},null,2),l=t.cookie?" --cookie 'fabric_session=…'":"",m=t.method!=="GET"&&t.method!=="DELETE"&&o?" --header 'Content-Type: application/json'":"",y=o?` --data '
${o}
'`:"",b=`curl --request ${t.method} \\
  --url ${c}${l}${m}${y}`,p={};t.cookie&&(p.Cookie="fabric_session=…"),t.method!=="GET"&&t.method!=="DELETE"&&o&&(p["Content-Type"]="application/json");const B=JSON.stringify(p,null,2),M=[`  method: "${t.method}"`,`  headers: ${B.replace(/\n/g,`
  `)}`,o?`  body: JSON.stringify(${o})`:""].filter(Boolean).join(`,
`);return{curl:{request:b,response:i},python:{request:`import requests

resp = requests.request(
    "${t.method}",
    "${c}",
    ${t.cookie?`cookies={"fabric_session": "…"},
    `:""}${o?`json=${o},
    `:""}
)
print(resp.json())`,response:i},javascript:{request:`const resp = await fetch("${c}", {
${M}
});
console.log(await resp.json());`,response:i}}}function qe(t){return t&&(t==="errors"||A(t))?t:v}function Re(){const[t,n]=V(),r=qe(t.get("api")),d=typeof window>"u"?"":window.location.origin,c=r==="errors"?void 0:A(r);function o(i){const l=new URLSearchParams(t);i===v?l.delete("api"):l.set("api",i),n(l,{replace:!0})}return e.jsxs("div",{className:"-mx-8 -my-8 flex h-[calc(100vh-3.5rem)] overflow-hidden",children:[e.jsxs("aside",{className:"flex w-72 shrink-0 flex-col border-r border-border bg-card",children:[e.jsxs("div",{className:"border-b border-border px-5 py-4",children:[e.jsx("h1",{className:"text-sm font-semibold text-foreground",children:"接口文档"}),e.jsxs("p",{className:"mt-1 text-xs leading-5 text-muted-foreground",children:["全部 ",_.reduce((i,l)=>i+l.items.filter(m=>m.kind==="api").length,0)," ","个接口，按分类浏览。"]})]}),e.jsx("nav",{"aria-label":"接口列表",className:"flex-1 space-y-6 overflow-y-auto px-3 py-5",children:_.map(i=>e.jsxs("div",{children:[e.jsx("p",{className:"px-3 pb-2 text-[15px] font-semibold text-foreground",children:i.title}),e.jsx("div",{className:"space-y-0.5",children:i.items.map(l=>{const m=l.kind==="api"?l.doc.id:l.id,y=l.kind==="api"?l.doc.title:l.title,b=l.kind==="api"?l.doc.method:void 0,p=r===m;return e.jsxs("button",{type:"button","aria-current":p?"page":void 0,onClick:()=>o(m),className:x("flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left transition-colors",p?"bg-blue-50 text-blue-600":"text-slate-600 hover:bg-slate-50 hover:text-slate-900"),children:[b?e.jsx($,{method:b,active:p}):null,e.jsx("span",{className:x("text-sm",p&&"font-medium"),children:y})]},m)})})]},i.title))})]}),e.jsxs("div",{className:"min-w-0 flex-1 overflow-y-auto px-8 py-8",children:[r==="errors"?e.jsx(Ee,{origin:d}):null,c?e.jsx(Se,{doc:c,origin:d}):null]})]})}function $({method:t,active:n}){const r=t==="GET"?n?"bg-emerald-600 text-white":"bg-emerald-50 text-emerald-600":t==="PATCH"?n?"bg-amber-500 text-white":"bg-amber-50 text-amber-600":t==="PUT"?n?"bg-violet-600 text-white":"bg-violet-50 text-violet-600":t==="DELETE"?n?"bg-rose-600 text-white":"bg-rose-50 text-rose-600":n?"bg-blue-600 text-white":"bg-blue-50 text-blue-500";return e.jsx("span",{className:x("inline-flex w-[3.75rem] shrink-0 justify-center rounded px-0 py-0.5 font-mono text-[10px] font-bold tracking-wide",r),children:t})}function Se({doc:t,origin:n}){const[r,d]=f.useState("curl"),o=f.useMemo(()=>t.id==="chat"||t.id==="messages"?X(t.id,n):Te(t,n),[t,n])[r],i=t.id==="chat"||t.id==="messages";return e.jsxs("article",{children:[e.jsxs("header",{className:"mb-8",children:[e.jsx("h2",{className:"text-xl font-semibold tracking-tight text-foreground",children:t.title}),e.jsx("p",{className:"mt-1 text-sm text-muted-foreground",children:t.summary}),e.jsx("p",{className:"mt-2 text-sm leading-6 text-foreground/80",children:e.jsx(T,{text:t.description})}),e.jsxs("div",{className:"mt-4 flex flex-wrap items-center gap-2",children:[e.jsx($,{method:t.method,active:!0}),e.jsx("code",{className:"rounded-md bg-muted px-2 py-1 font-mono text-sm text-foreground",children:t.path}),t.adminOnly?e.jsx("span",{className:"text-xs text-amber-700",children:"管理员"}):t.cookie?e.jsx("span",{className:"text-xs text-muted-foreground",children:"需登录"}):null,t.protocol?e.jsx("span",{className:"text-xs text-muted-foreground",children:t.protocol}):null]})]}),e.jsxs("div",{className:"grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]",children:[e.jsxs("div",{className:"min-w-0 space-y-8",children:[t.auth.length>0?e.jsx(h,{title:"Authorizations",children:e.jsx(g,{fields:t.auth})}):null,t.headers.length>0?e.jsx(h,{title:"Headers",children:e.jsx(g,{fields:t.headers})}):null,t.query&&t.query.length>0?e.jsx(h,{title:"Query",children:e.jsx(g,{fields:t.query})}):null,t.body.length>0?e.jsx(h,{title:"Body",hint:"application/json",children:e.jsx(g,{fields:t.body})}):null,t.response.length>0?e.jsx(h,{title:"响应字段",children:e.jsx(g,{fields:t.response})}):null]}),e.jsxs("aside",{className:"min-w-0 space-y-4 xl:sticky xl:top-4",children:[e.jsxs("section",{children:[e.jsx("h3",{className:"mb-2 text-sm font-semibold text-foreground",children:"调用示例"}),e.jsx(q,{langs:U,lang:r,onLang:d,code:o.request})]}),e.jsxs("section",{children:[e.jsxs("div",{className:"mb-2 flex items-baseline gap-2",children:[e.jsx("h3",{className:"text-sm font-semibold text-foreground",children:"响应"}),i?e.jsx("span",{className:"text-xs text-muted-foreground",children:"与上游一致，网关不改写正文"}):null]}),e.jsx(q,{code:o.response})]})]})]})]})}function Ee({origin:t}){return e.jsxs("div",{className:"space-y-8",children:[e.jsxs("div",{children:[e.jsx("h2",{className:"text-xl font-semibold tracking-tight text-foreground",children:"鉴权与错误"}),e.jsxs("p",{className:"mt-1 text-sm leading-6 text-muted-foreground",children:["网关先校验虚拟钥匙，再查 Model 映射和价格，再打上游。下面是网关自己返回的错误；上游 4xx/5xx 正文会按协议原样回传。网关错误统一为"," ",e.jsx("code",{className:"font-mono text-xs",children:'{"error":"<code>"}'}),"。"]})]}),e.jsxs("section",{className:"rounded-lg border border-border bg-card p-5",children:[e.jsx("h3",{className:"text-sm font-semibold text-foreground",children:"怎么接"}),e.jsxs("ul",{className:"mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-foreground/80",children:[e.jsxs("li",{children:["OpenAI SDK / Cursor：Base URL 填"," ",e.jsxs("code",{className:"rounded bg-muted px-1.5 py-0.5 font-mono text-xs",children:[t,"/v1"]}),"，Header ",e.jsx("code",{className:"font-mono text-xs",children:"Authorization: Bearer sk-fab-…"})]}),e.jsxs("li",{children:["Anthropic SDK / Claude Code：Base URL 填"," ",e.jsx("code",{className:"rounded bg-muted px-1.5 py-0.5 font-mono text-xs",children:t}),"，Header ",e.jsx("code",{className:"font-mono text-xs",children:"x-api-key: sk-fab-…"})]}),e.jsx("li",{children:"同一把 VK 可打两个端点；官方 Key 不会出现在调用方请求里。"}),e.jsxs("li",{children:["可选请求头 ",e.jsx("code",{className:"font-mono text-xs",children:"x-fabric-context"})," 可带"," ",e.jsx("code",{className:"font-mono text-xs",children:"project_id"})," /"," ",e.jsx("code",{className:"font-mono text-xs",children:"task_type"})," /"," ",e.jsx("code",{className:"font-mono text-xs",children:"run_id"}),"，写入请求流水，不送到上游。"]})]})]}),e.jsx("div",{className:"space-y-4",children:Q.map(n=>e.jsxs("article",{className:"rounded-lg border border-border bg-card p-5",children:[e.jsxs("div",{className:"flex flex-wrap items-center gap-2",children:[e.jsx(S,{variant:"outline",children:n.status}),e.jsx("code",{className:"font-mono text-sm font-medium text-foreground",children:n.code})]}),e.jsx("p",{className:"mt-2 text-sm leading-6 text-foreground/80",children:e.jsx(T,{text:n.when})}),e.jsx("div",{className:"mt-3",children:e.jsx(Oe,{label:"响应",value:Ae(n.sample)})})]},`${n.status}-${n.code}`))})]})}function h({title:t,hint:n,children:r}){return e.jsxs("section",{children:[e.jsxs("div",{className:"mb-3 flex items-baseline gap-2 border-b border-border pb-2",children:[e.jsx("h3",{className:"text-sm font-semibold text-foreground",children:t}),n?e.jsx("span",{className:"text-xs text-muted-foreground",children:n}):null]}),r]})}function g({fields:t}){return e.jsx("div",{className:"divide-y divide-border",children:t.map(n=>e.jsx(C,{field:n},n.name))})}function C({field:t,depth:n=0}){var o;const[r,d]=f.useState(!1),c=!!((o=t.children)!=null&&o.length);return e.jsxs("div",{style:{paddingLeft:n?n*16:0},children:[e.jsxs("div",{className:"py-3",children:[e.jsxs("div",{className:"flex flex-wrap items-center gap-2",children:[c?e.jsxs("button",{type:"button","aria-expanded":r,onClick:()=>d(i=>!i),className:"inline-flex items-center gap-1 font-mono text-sm font-medium text-foreground",children:[e.jsx(J,{className:x("h-3.5 w-3.5 transition-transform",r&&"rotate-90")}),t.name]}):e.jsx("span",{className:"font-mono text-sm font-medium text-foreground",children:t.name}),e.jsx("span",{className:"font-mono text-xs text-muted-foreground",children:t.type}),t.required?e.jsx(S,{variant:"outline",className:"border-destructive/40 text-destructive",children:"required"}):null,t.defaultValue?e.jsxs("span",{className:"text-xs text-muted-foreground",children:["default: ",t.defaultValue]}):null]}),e.jsx("p",{className:"mt-1.5 text-sm leading-6 text-foreground/80",children:e.jsx(T,{text:t.description})})]}),c&&r?t.children.map(i=>e.jsx(C,{field:i,depth:n+1},i.name)):null]})}function q({code:t,langs:n,lang:r,onLang:d}){return e.jsxs("div",{className:"overflow-hidden rounded-lg border border-border bg-slate-900 text-slate-100 shadow-card",children:[e.jsxs("div",{className:"flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2",children:[e.jsx("div",{className:"flex min-w-0 items-center gap-2",children:n&&r&&d?e.jsx("div",{className:"flex gap-0.5",children:n.map(c=>e.jsx("button",{type:"button",onClick:()=>d(c.id),className:x("rounded px-2 py-0.5 text-[11px]",r===c.id?"bg-white/15 text-white":"text-slate-400 hover:bg-white/10 hover:text-slate-200"),children:c.label},c.id))}):e.jsx("span",{className:"text-xs text-slate-400",children:"JSON"})}),e.jsx(R,{value:t,testId:n?"copy-example":void 0})]}),e.jsx("pre",{className:"max-h-[32rem] overflow-auto p-4 font-mono text-[12px] leading-6",children:t})]})}function Oe({label:t,value:n}){return e.jsxs("div",{className:"overflow-hidden rounded-md border border-border bg-muted",children:[e.jsxs("div",{className:"flex items-center justify-between px-3 py-1.5",children:[e.jsx("span",{className:"text-[11px] text-muted-foreground",children:t}),e.jsx(R,{value:n,light:!0})]}),e.jsx("pre",{className:"overflow-x-auto px-3 pb-3 font-mono text-[11px] leading-5 text-foreground/80",children:n})]})}function R({value:t,light:n,testId:r}){const[d,c]=f.useState(!1);return e.jsx(L,{type:"button",variant:"ghost",size:"icon","data-testid":r,className:x("h-7 w-7 shrink-0",n?"text-muted-foreground":"text-slate-300 hover:bg-white/10 hover:text-white"),"aria-label":"复制",onClick:async()=>{try{await navigator.clipboard.writeText(t),c(!0),setTimeout(()=>c(!1),1500)}catch{}},children:d?e.jsx(D,{className:"h-3.5 w-3.5 text-emerald-400"}):e.jsx(F,{className:"h-3.5 w-3.5"})})}function T({text:t}){const n=t.split(/(`[^`]+`)/g);return e.jsx(e.Fragment,{children:n.map((r,d)=>r.startsWith("`")&&r.endsWith("`")?e.jsx("code",{className:"rounded bg-muted px-1 py-0.5 font-mono text-[12px]",children:r.slice(1,-1)},d):e.jsx("span",{children:r},d))})}function Ae(t){try{return JSON.stringify(JSON.parse(t),null,2)}catch{return t}}export{Re as default};
