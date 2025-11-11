import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const clientKey = process.env.AMPLITUDE_CLIENT_KEY;

export async function getExperiment(user) {
  let userId = user.id;
  if (user.platform) {
    userId = `${user.platform}_${user.id}`;
  } else if (user.identifier) {
    userId = user.identifier;
  }

  const headers = { Authorization: `Api-Key ${clientKey}` };
  const resp = await axios.get(
    `https://api.lab.amplitude.com/v1/vardata?user_id=${userId}`,
    { headers }
  );
  return resp.data;
}


