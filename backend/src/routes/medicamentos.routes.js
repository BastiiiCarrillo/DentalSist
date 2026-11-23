const express = require('express');
const router = express.Router();
const medicamentosCatalogo = require('../models/medicamentos.json');

router.get('/', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  if (!query) {
    return res.status(200).json({ total: medicamentosCatalogo.length, medicamentos: medicamentosCatalogo });
  }

  const normalizar = (txt) => (txt || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const qNorm = normalizar(query);

  const filtrados = medicamentosCatalogo.filter(m => {
    return normalizar(m.nombre).includes(qNorm) ||
           normalizar(m.dosis).includes(qNorm) ||
           normalizar(m.categoria).includes(qNorm) ||
           normalizar(m.presentacion).includes(qNorm);
  }).sort((a, b) => {
    const aStarts = normalizar(a.nombre).startsWith(qNorm);
    const bStarts = normalizar(b.nombre).startsWith(qNorm);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return a.nombre.localeCompare(b.nombre);
  });

  return res.status(200).json({ total: filtrados.length, medicamentos: filtrados });
});

module.exports = router;
