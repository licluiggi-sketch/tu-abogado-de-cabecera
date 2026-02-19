async function consultar() {
  const pregunta = document.getElementById("pregunta").value;
  const resultado = document.getElementById("resultado");

  resultado.innerText = "Consultando...";

  try {
    const response = await fetch("http://localhost:3000/consultar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ pregunta })
    });

    const data = await response.json();
    resultado.innerText = data.respuesta;
  } catch (error) {
    resultado.innerText = "Error al conectar con el servidor";
  }
}
