import mammoth from 'mammoth';

export const extractTextFromFile = async (file) => {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'txt') {
    return await readAsText(file);
  } else if (ext === 'docx') {
    return await readDocx(file);
  } else if (ext === 'pdf') {
    return await readPdfText(file);
  }
  return `[${file.name}]`;
};

const readAsText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });

const readDocx = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};

const readPdfText = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const bytes = new Uint8Array(e.target.result);
        let text = '';
        for (let i = 0; i < bytes.length; i++) {
          const c = bytes[i];
          if (c >= 32 && c < 127) text += String.fromCharCode(c);
          else if (c === 10 || c === 13) text += '\n';
        }
        const cleaned = text.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s{3,}/g, '\n').trim();
        resolve(cleaned || `[PDF: ${file.name}]`);
      } catch {
        resolve(`[PDF: ${file.name}]`);
      }
    };
    reader.onerror = () => resolve(`[PDF: ${file.name}]`);
    reader.readAsArrayBuffer(file);
  });
