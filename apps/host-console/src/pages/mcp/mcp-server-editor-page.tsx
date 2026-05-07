import { useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { useMcpServerEditor } from "@/features/mcp/hooks/use-mcp-server-editor";

export function McpServerEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editorId = id === "new" ? "__new__" : id;
  const { text, setText, loading, saving, error, notice, jsonError, save } = useMcpServerEditor(editorId);

  async function onSave() {
    const savedId = await save();
    if (savedId) {
      navigate(`/mcp/${savedId}`, { replace: true });
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCP JSON 编辑</h1>
          <p className="text-muted-foreground mt-1">修改配置后保存，再回到列表进行探测。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/mcp")}>
            返回列表
          </Button>
          <Button onClick={() => void onSave()} disabled={saving || loading || !!jsonError}>
            {saving ? "保存中..." : "保存配置"}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
        {jsonError ? <p className="text-sm text-destructive">JSON 错误：{jsonError}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p className="text-sm text-green-600">{notice}</p> : null}
      </div>

      {!loading ? (
        <div className="mt-4 overflow-hidden rounded-md border border-input">
          <Editor
            height="560px"
            defaultLanguage="json"
            language="json"
            value={text}
            onChange={(value) => setText(value ?? "")}
            options={{
              minimap: { enabled: false },
              formatOnPaste: true,
              formatOnType: true,
              scrollBeyondLastLine: false,
              fontSize: 13,
              tabSize: 2
            }}
          />
        </div>
      ) : null}
    </main>
  );
}
