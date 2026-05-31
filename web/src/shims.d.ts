// Deep style imports from react-syntax-highlighter ship no type declarations.
declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  const styles: Record<string, Record<string, React.CSSProperties>>;
  export const oneDark: Record<string, React.CSSProperties>;
  export default styles;
}
