function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);

    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Impossibile caricare ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.src = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Impossibile caricare ${src}`)), { once: true });
    document.head.append(script);
  });
}

let librariesPromise;

async function ensurePdfLibraries() {
  if (!librariesPromise) {
    librariesPromise = Promise.all([
      loadScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"),
      loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js")
    ]);
  }

  await librariesPromise;

  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    throw new Error("Le librerie PDF non sono disponibili.");
  }
}

export async function generatePdfFromNode(node, fileName) {
  await ensurePdfLibraries();

  const canvas = await window.html2canvas(node, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff"
  });

  const imageData = canvas.toDataURL("image/png");
  const pdf = new window.jspdf.jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ratio = canvas.width / canvas.height;
  let renderedWidth = pageWidth;
  let renderedHeight = renderedWidth / ratio;

  if (renderedHeight > pageHeight) {
    renderedHeight = pageHeight;
    renderedWidth = renderedHeight * ratio;
  }

  const offsetX = (pageWidth - renderedWidth) / 2;
  const offsetY = (pageHeight - renderedHeight) / 2;

  pdf.addImage(imageData, "PNG", offsetX, offsetY, renderedWidth, renderedHeight);

  const blob = pdf.output("blob");
  pdf.save(fileName);

  return new File([blob], fileName, { type: "application/pdf" });
}
