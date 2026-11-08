---
name: feishu-documents
description: 按用户要求创建、读取和追加飞书文档。
---
读取现有文档用 read_document；不在白名单时请用户在配置中心添加文档ID并授予应用访问。
create_document 可在获准文件夹创建，或在允许创建独立文档时省略 folder_token。
创建返回 document_id 后调用 append_document 写入内容，再 read_document 核对；每次追加最多50段。
本会话创建的文档会被持久登记，后续可读取及追加。只在调用成功后返回真实链接。
没有权限时报告具体错误与需要配置的资源，不把失败说成成功。
