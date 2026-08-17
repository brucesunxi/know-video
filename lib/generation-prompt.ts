export function contentPromptForGeneration(value: string) {
  let prompt = value.trim();
  const trailingStyleInstructions = [
    /\n\n应用模板“[^”]+”的 style：[\s\S]+$/u,
    /\n\nApply the “[^”]+” template style:[\s\S]+$/u,
    /\n\n应用“[^”]+”的 style：[\s\S]+$/u,
    /\n\nApply the “[^”]+” style:[\s\S]+$/u
  ];
  for (const pattern of trailingStyleInstructions) prompt = prompt.replace(pattern, "").trim();

  // Older composer versions could place the generated style sentence before
  // content typed immediately afterward. Keep the user's first real sentence.
  prompt = prompt
    .replace(/^Apply the [“"][^”"]+[”"] style:\s*[^\p{Script=Han}\r\n]+?[.!?](?=\s*\p{Script=Han})\s*/u, "")
    .replace(/^应用“[^”]+”的 style：.*?(?=(?:请|帮我|制作|生成|创建|做一个|我要))/u, "")
    .trim();
  return prompt;
}
